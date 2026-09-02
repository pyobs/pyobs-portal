from __future__ import annotations

import importlib
import importlib.metadata
import inspect
import pkgutil
import types
import typing
from types import ModuleType
from typing import Any

from django.core.cache import cache
from pydantic import BaseModel, ValidationError

import pyobs.robotic.scheduler.constraints as constraints_module
import pyobs.robotic.scheduler.merits as merits_module
import pyobs.robotic.scheduler.targets as targets_module
import pyobs.robotic.scripts as scripts_module
import pyobs.robotic.utils.exptime as exptime_module
import pyobs.robotic.utils.skyflats.pointing as skyflats_pointing_module
import pyobs.robotic.utils.skyflats.priorities as skyflats_priorities_module
from pyobs.interfaces.interface import Interface, get_registered_interface
from pyobs.object import get_class_from_string
from pyobs.robotic.scheduler.constraints.constraint import Constraint
from pyobs.robotic.scheduler.merits.merit import Merit
from pyobs.robotic.scheduler.targets.target import Target
from pyobs.robotic.scheduler.targets.picker.picker import Picker
from pyobs.robotic.scripts.script import Script
from pyobs.robotic.utils.exptime import ExposureTimeProvider
from pyobs.robotic.utils.skyflats.pointing import SkyFlatsBasePointing
from pyobs.robotic.utils.skyflats.priorities import SkyflatPriorities
from pyobs.utils.serialization import PolymorphicBaseModel

from . import webadmin

try:
    import pyobs.robotic.scheduler.targets.picker as picker_module
except ImportError:
    picker_module = None

IGNORED_FIELDS = {"cost", "target_dependent", "exptime_done"}

# Polymorphic script-tree bases and the package each is scanned in for concrete
# subclasses. `Script` itself is handled separately by reusing `script_tree()`.
_PROVIDER_SCAN_PACKAGES: dict[type[PolymorphicBaseModel], ModuleType] = {
    ExposureTimeProvider: exptime_module,
    SkyFlatsBasePointing: skyflats_pointing_module,
    SkyflatPriorities: skyflats_priorities_module,
}

# Observatory-specific extension packages are discovered by naming convention, not
# configuration: any *installed* top-level package prefixed "pyobs_" is scanned for the
# same pyobs.robotic.* submodules as pyobs-core itself -- "scripts" for Script
# subclasses, and the relative path of each entry in _PROVIDER_SCAN_PACKAGES (e.g.
# "utils.exptime") for provider subclasses. A package that doesn't ship a matching
# submodule is simply skipped. This means installing an extension package and
# restarting is enough for its scripts/providers to show up in the builder -- no env
# var, settings entry, or entry-point declaration required. See README.md "Extension
# packages" for the operator-facing version of this.
_ROBOTIC_PREFIX = "pyobs.robotic."


def _relative_to_robotic(module: ModuleType) -> str:
    return module.__name__.removeprefix(_ROBOTIC_PREFIX)


def _installed_extension_packages() -> list[str]:
    # packages_distributions() maps top-level import name -> owning distribution(s),
    # built from each package's RECORD/metadata rather than the legacy (and, for
    # modern build backends like hatchling/uv, frequently absent) top_level.txt.
    return sorted(name for name in importlib.metadata.packages_distributions() if name.startswith("pyobs_"))


def _extension_package_label(package_name: str) -> str:
    """Distribution name for an extension package's import name, e.g. "pyobs-iagvt" for
    "pyobs_iagvt" -- used as the script tree's top-level branch label so it reads as the
    package name a user would `pip install`, not the Python import name. Falls back to the
    import name itself if dist-info metadata isn't available (e.g. a package added to
    sys.path directly, as in tests)."""
    try:
        dists = importlib.metadata.packages_distributions().get(package_name)
    except Exception:
        dists = None
    return dists[0] if dists else package_name


def _extension_submodule(package_name: str, relative: str) -> ModuleType | None:
    try:
        return importlib.import_module(f"{package_name}.{relative}")
    except Exception:
        return None


def _reexport_aliases(package: ModuleType, base: type) -> dict[str, str]:
    """Map a package's own re-exported class names to their canonical `module.ClassName`.

    A package's `__init__.py` commonly re-exports its concrete classes for a shorter public
    import path (e.g. an extension package's `scripts/__init__.py` doing `from .myscript import
    MyScript`, so both `<package>.scripts.MyScript` and `<package>.scripts.myscript.MyScript`
    import the same class). `script_tree()`/`_polymorphic_registry()` key everything by the
    canonical `cls.__module__.cls.__name__` (from walking submodules), so a task whose stored
    script YAML was written against the short re-exported path -- a legitimate, working import
    -- would otherwise show as an unrecognized class in the builder even though pyobs-core/the
    extension package resolves it fine. Only returns entries where the short form actually
    differs from the canonical one.
    """
    aliases: dict[str, str] = {}
    for name, obj in inspect.getmembers(package):
        if inspect.isclass(obj) and issubclass(obj, base) and obj is not base:
            short = f"{package.__name__}.{name}"
            canonical = _fqcn(obj)
            if short != canonical:
                aliases[short] = canonical
    return aliases


def _strip_ignored(schema: dict[str, Any]) -> dict[str, Any]:
    schema = dict(schema)
    if "properties" in schema:
        schema["properties"] = {k: v for k, v in schema["properties"].items() if k not in IGNORED_FIELDS}
    if "required" in schema:
        schema["required"] = [f for f in schema["required"] if f not in IGNORED_FIELDS]
    return schema


def _subclasses(module: ModuleType, base: type[BaseModel]) -> dict[str, type[BaseModel]]:
    result: dict[str, type[BaseModel]] = {}
    for name, obj in inspect.getmembers(module):
        if inspect.isclass(obj) and issubclass(obj, base) and obj is not base:
            result[name] = obj
    return result


def _schema_for(cls: type[BaseModel]) -> dict[str, Any] | None:
    try:
        return _strip_ignored(cls.model_json_schema())
    except Exception:
        return None


def constraint_schemas() -> dict[str, Any]:
    result = {}
    for name, cls in _subclasses(constraints_module, Constraint).items():
        s = _schema_for(cls)
        if s is not None:
            result[name] = s
    return result


def merit_schemas() -> dict[str, Any]:
    result = {}
    for name, cls in _subclasses(merits_module, Merit).items():
        s = _schema_for(cls)
        if s is not None:
            result[name] = s
    return result


def target_schemas() -> dict[str, Any]:
    result = {}
    for name, cls in _subclasses(targets_module, Target).items():
        s = _schema_for(cls)
        if s is not None:
            result[name] = s
    return result


def picker_schemas() -> dict[str, Any]:
    result = {}
    if picker_module is None:
        return result
    for name, cls in _subclasses(picker_module, Picker).items():
        s = _schema_for(cls)
        if s is not None:
            result[name] = s
    return result


def _fqcn(cls: type) -> str:
    return f"{cls.__module__}.{cls.__name__}"


def _as_polymorphic_base(candidate: Any) -> type[PolymorphicBaseModel] | None:
    """If `candidate` is a (non-abstract-base) PolymorphicBaseModel type, return it."""
    if inspect.isclass(candidate) and issubclass(candidate, PolymorphicBaseModel) and candidate is not PolymorphicBaseModel:
        return candidate
    return None


def _polymorphic_field_base(annotation: Any) -> tuple[str, type[PolymorphicBaseModel]] | None:
    """Classify a pydantic field annotation as a polymorphic script/provider field.

    Unwraps `list[X]`, `dict[K, X]`, `X | None` and plain unions to find a member
    that is a `PolymorphicBaseModel` subclass. Returns `(container, base)` where
    container is one of "single" | "optional" | "array" | "map", or `None` if the
    field isn't polymorphic.
    """
    origin = typing.get_origin(annotation)
    if origin is list:
        args = typing.get_args(annotation)
        base = _as_polymorphic_base(args[0]) if args else None
        return ("array", base) if base is not None else None
    if origin is dict:
        args = typing.get_args(annotation)
        base = _as_polymorphic_base(args[1]) if len(args) > 1 else None
        return ("map", base) if base is not None else None
    if origin is types.UnionType or origin is typing.Union:
        args = typing.get_args(annotation)
        is_optional = type(None) in args
        base = None
        for arg in args:
            if arg is type(None):
                continue
            base = _as_polymorphic_base(arg)
            if base is not None:
                break
        if base is None:
            return None
        return ("optional" if is_optional else "single", base)
    base = _as_polymorphic_base(annotation)
    return ("single", base) if base is not None else None


def _nested_model_for(annotation: Any) -> type[BaseModel] | None:
    """Find the (non-polymorphic) BaseModel nested inside a field annotation, if any."""
    origin = typing.get_origin(annotation)
    if origin is list:
        args = typing.get_args(annotation)
        return _nested_model_for(args[0]) if args else None
    if origin is dict:
        args = typing.get_args(annotation)
        return _nested_model_for(args[1]) if len(args) > 1 else None
    if origin is types.UnionType or origin is typing.Union:
        for arg in typing.get_args(annotation):
            if arg is type(None):
                continue
            nested = _nested_model_for(arg)
            if nested is not None:
                return nested
        return None
    if inspect.isclass(annotation) and issubclass(annotation, BaseModel):
        return annotation
    return None


def _annotate_polymorphic(schema: dict[str, Any], cls: type[BaseModel]) -> dict[str, Any]:
    """Mutate `schema` (as produced by `_schema_for(cls)`) in place, marking every
    polymorphic field with an `x-pyobs-polymorphic` keyword so the frontend can
    render a type-selector + nested form without any schema-shape heuristics."""
    defs = schema.get("$defs", {})

    def _ref_target(node: Any) -> tuple[str, dict[str, Any]] | None:
        if not isinstance(node, dict):
            return None
        ref = node.get("$ref")
        if not isinstance(ref, str) or not ref.startswith("#/$defs/"):
            return None
        name = ref[len("#/$defs/") :]
        target = defs.get(name)
        return (name, target) if isinstance(target, dict) else None

    def _walk(model_cls: type[BaseModel], node: dict[str, Any], visited: set[str]) -> None:
        properties = node.get("properties")
        if not isinstance(properties, dict):
            return
        for field_name, field_info in model_cls.model_fields.items():
            if field_name in IGNORED_FIELDS or field_name not in properties:
                continue
            prop = properties[field_name]
            classified = _polymorphic_field_base(field_info.annotation)
            if classified is not None:
                container, base = classified
                target = prop
                if container == "array" and isinstance(prop.get("items"), dict):
                    target = prop["items"]
                elif container == "map" and isinstance(prop.get("additionalProperties"), dict):
                    target = prop["additionalProperties"]
                target["x-pyobs-polymorphic"] = {"base": _fqcn(base), "container": container}
                continue
            # Not polymorphic itself: recurse into a plain nested model, if any.
            nested_cls = _nested_model_for(field_info.annotation)
            if nested_cls is None:
                continue
            ref_hit = _ref_target(prop) or _ref_target(prop.get("items")) or _ref_target(prop.get("additionalProperties"))
            if ref_hit is None:
                continue
            name, def_node = ref_hit
            if name in visited:
                continue
            visited.add(name)
            _walk(nested_cls, def_node, visited)

    _walk(cls, schema, {cls.__name__})
    return schema


def _annotate_module_refs(schema: dict[str, Any], cls: type[BaseModel]) -> dict[str, Any]:
    """Mutate `schema` in place, marking every module-name field with an `x-pyobs-module-ref`
    keyword so the frontend can render a module-name dropdown/datalist instead of a free-text
    input (issue #98).

    A module-name field is any field whose pyobs-core annotation carries one or more
    `pyobs.interfaces` `Interface` subclasses as `Annotated` metadata, e.g.
    `camera: Annotated[str, ICamera]` -- real Python-level type introspection, the same approach
    `_annotate_polymorphic` uses for polymorphic fields, not a hand-maintained
    field-name-to-interface table (which would be wrong: the same field name can require
    different interfaces on different script classes, e.g. `ImagingScript.camera` vs.
    `DarkBiasScript.camera`). No effect until pyobs-core actually carries this metadata
    (pyobs/pyobs-core#808) -- until then this simply finds nothing to mark.

    Only walks `cls.model_fields` directly -- unlike `_annotate_polymorphic`, this does not
    recurse into nested `$defs` models. A module-ref field on a nested model (e.g. some future
    `InstrumentConfig.something`) would need its own `_annotate_module_refs(def_node, NestedCls)`
    call added at that recursion point; not needed today since every field pyobs-core#808 tags
    lives directly on a `Script` subclass.
    """
    properties = schema.get("properties")
    if not isinstance(properties, dict):
        return schema
    for field_name, field_info in cls.model_fields.items():
        if field_name in IGNORED_FIELDS or field_name not in properties:
            continue
        interfaces = [
            m.__name__ for m in field_info.metadata if inspect.isclass(m) and issubclass(m, Interface)
        ]
        if interfaces:
            # `required` (pyobs-portal#132): whether the frontend may auto-select this field's
            # sole candidate module when there's exactly one. A field with a default (almost
            # always `None`, e.g. ImagingScript.telescope/filters/autoguider/acquisition) is
            # frequently *meant* to stay unset -- their docstrings read "Required if ..." -- so
            # only a field with no default (is_required()) is safe to auto-fill.
            properties[field_name]["x-pyobs-module-ref"] = {
                "interfaces": interfaces,
                "required": field_info.is_required(),
            }
    return schema


def module_ref_options(tree: dict[str, Any] | None = None) -> dict[str, Any]:
    """{"available": bool, "options": {interface_name: [module_name, ...]}} for every
    `x-pyobs-module-ref` interface referenced anywhere in `tree` (a `script_tree()` result;
    scans a fresh one if not given).

    `available` is False only when `webadmin.get_module_classes()` couldn't be trusted right now
    (`WEBADMIN_URL`/`WEBADMIN_TOKEN` unset, web-admin unreachable, or an unusable response) --
    the frontend renders a real `<select>` when True and falls back to a plain free-text input
    when False, since script editing must never be blocked on web-admin being reachable. This is
    a distinct signal from an individual interface's option list being empty: when `available`
    is True, an empty list for some interface genuinely means "no configured module implements
    this", which is then an enforceable error (see `validate_script`'s module-ref check below) --
    unlike the `available: False` case, where an empty list means "we don't know" and nothing
    should be rejected. A module whose class fails to resolve/import is skipped rather than
    failing the whole lookup, same defensive style as `_scan_concrete_subclasses`.

    A module name can appear more than once in `webadmin.get_module_classes()`'s fleet-aggregated
    list (once per host, issue #119): a name is included for an interface if *any* of its rows
    implements that interface (deduping the name itself, not the rows), so a name isn't dropped
    from an interface's options just because one host's copy happens to come first and doesn't
    implement it.
    """
    interface_names: set[str] = set()

    def _collect(node: Any) -> None:
        if not isinstance(node, dict):
            return
        marker = node.get("x-pyobs-module-ref")
        if isinstance(marker, dict):
            interface_names.update(marker.get("interfaces", []))
        for value in node.values():
            _collect(value)

    _collect(tree if tree is not None else script_tree())

    options: dict[str, list[str]] = {name: [] for name in interface_names}
    if not interface_names:
        return {"available": True, "options": options}

    classes = webadmin.get_module_classes()
    if classes is None:
        return {"available": False, "options": options}

    interfaces = {name: get_registered_interface(name) for name in interface_names}
    for entry in classes:
        try:
            cls = get_class_from_string(entry["class"])
        except Exception:
            continue
        if not inspect.isclass(cls):
            continue
        module_name = entry["name"]
        for name, iface in interfaces.items():
            if iface is not None and issubclass(cls, iface) and module_name not in options[name]:
                options[name].append(module_name)
    return {"available": True, "options": options}


def _scan_concrete_subclasses(
    package: ModuleType, base: type[PolymorphicBaseModel]
) -> tuple[list[type[PolymorphicBaseModel]], dict[str, str]]:
    """Recursively scan `package` (and subpackages) for concrete subclasses of `base`, plus
    any re-export aliases found along the way (see `_reexport_aliases`).

    Dedupes by class identity rather than `cls.__module__`, since some pyobs-core
    polymorphic classes override `__module__` to a shorter (sometimes stale) path.
    """
    found: dict[int, type[PolymorphicBaseModel]] = {}
    aliases: dict[str, str] = {}

    def _scan(pkg: ModuleType) -> None:
        aliases.update(_reexport_aliases(pkg, base))
        for _, name, ispkg in pkgutil.iter_modules(pkg.__path__):
            if name.startswith("_"):
                # Private implementation module/subpackage (pyobs-portal#131) -- pkgutil only
                # skips __init__, so this excludes it (and doesn't recurse into a _internal/
                # subpackage) rather than surfacing its classes as public provider candidates.
                continue
            full_name = f"{pkg.__name__}.{name}"
            try:
                mod = importlib.import_module(full_name)
            except Exception:
                continue
            if ispkg:
                _scan(mod)
            for _, obj in inspect.getmembers(mod):
                if (
                    inspect.isclass(obj)
                    and issubclass(obj, base)
                    and obj is not base
                    and not inspect.isabstract(obj)
                ):
                    found[id(obj)] = obj

    _scan(package)
    return list(found.values()), aliases


def _polymorphic_registry(tree: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    registry: dict[str, Any] = {}
    aliases: dict[str, str] = {}

    script_candidates: list[dict[str, Any]] = []

    def _collect(node: dict[str, Any], path: list[str]) -> None:
        for key, value in node.items():
            if isinstance(value, dict) and "class" in value and "schema" in value:
                script_candidates.append(
                    {"class": value["class"], "path": "/".join(path + [key]), "title": key}
                )
            elif isinstance(value, dict):
                _collect(value, path + [key])

    _collect(tree, [])
    registry[_fqcn(Script)] = {"candidates": script_candidates}

    for base, package in _PROVIDER_SCAN_PACKAGES.items():
        classes, base_aliases = _scan_concrete_subclasses(package, base)
        aliases.update(base_aliases)
        relative = _relative_to_robotic(package)
        for pkg_name in _installed_extension_packages():
            ext_package = _extension_submodule(pkg_name, relative)
            if ext_package is not None:
                ext_classes, ext_aliases = _scan_concrete_subclasses(ext_package, base)
                classes += ext_classes
                aliases.update(ext_aliases)

        candidates = []
        for cls in classes:
            s = _schema_for(cls)
            if s is None:
                continue
            # Not annotated recursively: candidate schemas can nest their own
            # polymorphic fields (e.g. ArchiveSkyflatPriorities.archive) whose
            # base isn't itself registered here. Marking those would leave the
            # frontend an x-pyobs-polymorphic reference it can't resolve, so
            # such fields render as plain nested objects instead, same as today.
            candidates.append({"class": _fqcn(cls), "title": cls.__name__, "schema": s})
        registry[_fqcn(base)] = {"candidates": candidates}

    return registry, aliases


# A single task-editor page load fires /api/schema/scripts/ and /api/schema/modules/ (issue
# #98) as separate, near-simultaneous requests -- without this, both independently pay for the
# full recursive pkgutil/importlib scan + schema generation over pyobs.robotic.scripts. This is
# a de-duplication window, not a real staleness tolerance (module code doesn't change without a
# process restart anyway), so it's kept short. LocMemCache pickles values on set/get, so the
# cached tree is never the same object a caller could accidentally mutate.
_SCRIPT_TREE_CACHE_KEY = "pyobs_portal.api.schema.script_tree"
_SCRIPT_TREE_CACHE_TTL = 5  # seconds


def script_tree() -> dict[str, Any]:
    cached = cache.get(_SCRIPT_TREE_CACHE_KEY)
    if cached is not None:
        return cached

    aliases: dict[str, str] = {}

    def _scan(package: ModuleType) -> dict[str, Any]:
        # Re-exports (see _reexport_aliases) can happen at *any* nesting level -- a
        # subpackage's own __init__.py re-exporting its submodules' classes just as
        # readily as the top-level package -- so this is checked at every package
        # _scan() recurses into, not just once at the root.
        aliases.update(_reexport_aliases(package, Script))
        results: dict[str, Any] = {}
        for _, name, ispkg in pkgutil.iter_modules(package.__path__):
            if name.startswith("_"):
                # Private implementation module/subpackage (pyobs-portal#131) -- pkgutil only
                # skips __init__, so this excludes it (and doesn't recurse into a _internal/
                # subpackage) rather than surfacing its Script subclasses in the picker tree.
                continue
            full_name = f"{package.__name__}.{name}"
            try:
                mod = importlib.import_module(full_name)
            except Exception:
                continue
            if ispkg:
                sub = _scan(mod)
                if sub:
                    results[name] = sub
            else:
                classes = {}
                for cls_name, cls in inspect.getmembers(mod):
                    if (
                        inspect.isclass(cls)
                        and issubclass(cls, Script)
                        and cls is not Script
                        and cls.__module__ == full_name
                    ):
                        s = _schema_for(cls)
                        if s is not None:
                            _annotate_polymorphic(s, cls)
                            _annotate_module_refs(s, cls)
                            classes[cls_name] = {
                                "class": f"{cls.__module__}.{cls.__name__}",
                                "schema": s,
                            }
                if classes:
                    results[name] = classes
        return results

    tree = _scan(scripts_module)
    scripts_relative = _relative_to_robotic(scripts_module)
    for pkg_name in _installed_extension_packages():
        ext_scripts = _extension_submodule(pkg_name, scripts_relative)
        if ext_scripts is None:
            continue
        ext_tree = _scan(ext_scripts)
        if ext_tree:
            # Kept under its own top-level branch, labeled with the owning package (rather
            # than merged into pyobs-core's own module-path folders) so the script picker
            # tree shows which package each extension script came from -- see README.md
            # "Extension packages".
            tree[_extension_package_label(pkg_name)] = ext_tree

    registry, provider_aliases = _polymorphic_registry(tree)
    tree["$polymorphic"] = registry
    aliases.update(provider_aliases)
    # A task's stored script class may have been written against a package's short
    # re-exported path rather than the canonical module.ClassName the tree above uses
    # (see _reexport_aliases) -- the builder resolves an unrecognized class against this
    # table before giving up on it.
    tree["$aliases"] = aliases

    cache.set(_SCRIPT_TREE_CACHE_KEY, tree, _SCRIPT_TREE_CACHE_TTL)
    return tree


def _container_kind(annotation: Any) -> str:
    """Structural container shape of a field annotation, independent of what's
    inside: "single" | "optional" | "array" | "map"."""
    origin = typing.get_origin(annotation)
    if origin is list:
        return "array"
    if origin is dict:
        return "map"
    if origin is types.UnionType or origin is typing.Union:
        return "optional" if type(None) in typing.get_args(annotation) else "single"
    return "single"


def _unwrap_container(value: Any, container: str) -> list[Any]:
    if container in ("single", "optional"):
        return [] if value is None else [value]
    if container == "array":
        return value if isinstance(value, list) else []
    if container == "map":
        return list(value.values()) if isinstance(value, dict) else []
    return []


def _check_fields_for_classless_nodes(cls: type[BaseModel], data: dict[str, Any]) -> str | None:
    """Walk `cls`'s fields against `data`, recursing into plain nested models
    (e.g. `Configuration` -> `InstrumentConfig`) to reach polymorphic fields at
    any depth, and validating every polymorphic node found along the way."""
    for field_name, field_info in cls.model_fields.items():
        if field_name not in data:
            continue
        value = data[field_name]
        container = _container_kind(field_info.annotation)
        classified = _polymorphic_field_base(field_info.annotation)
        if classified is not None:
            _, base = classified
            for item in _unwrap_container(value, container):
                error = _check_no_classless_nodes(item, base)
                if error is not None:
                    return error
            continue
        nested_cls = _nested_model_for(field_info.annotation)
        if nested_cls is None:
            continue
        for item in _unwrap_container(value, container):
            if isinstance(item, dict):
                error = _check_fields_for_classless_nodes(nested_cls, item)
                if error is not None:
                    return error
    return None


def _check_no_classless_nodes(data: Any, expected_base: type[PolymorphicBaseModel] = Script) -> str | None:
    """Recursively require a resolvable, concrete `class` on every embedded
    polymorphic node (script nodes, and any nested provider node reachable
    through one -- `exposure_time`, `pointing`, `priorities` -- possibly
    through plain nested models like `Configuration`/`InstrumentConfig`).

    Errors are attributed to the innermost node that's actually wrong, not
    the outermost script.

    `Script.model_validate({})`/`{"scripts": [{}]}` succeed today by silently
    falling back to the abstract `Script` base (whose `run()` raises
    `NotImplementedError`) -- `Script` isn't itself abstract, unlike the
    provider bases (pydantic already rejects a class-less/abstract provider
    node on its own) -- so without this check `validate_script/` would report
    "valid" for a script that can never actually execute.
    """
    unknown_label = "unknown script class" if expected_base is Script else "unknown class"
    if not isinstance(data, dict):
        return None
    cls_name = data.get("class")
    if cls_name is None:
        return "no script class selected" if expected_base is Script else f"no class selected for '{expected_base.__name__}'"
    try:
        cls = get_class_from_string(cls_name)
    except (ImportError, AttributeError):
        return f"{unknown_label} '{cls_name}'"
    if not (inspect.isclass(cls) and issubclass(cls, expected_base) and cls is not expected_base):
        return f"{unknown_label} '{cls_name}'"
    return _check_fields_for_classless_nodes(cls, data)


def _summarize_validation_error(e: ValidationError) -> tuple[str, list[dict[str, Any]]]:
    """issue #102: pydantic's own str(e)/repr dumps every error verbatim, one
    block per offending field path, each with a
    "https://errors.pydantic.dev/..." doc link -- unreadable as a one-line
    status message, and meaningless to an end user of this app.

    Returns a short summary plus each error's `loc` (a path of field names /
    list indices, e.g. ["configuration", "instrument_configs", 0, "window",
    0]) and `msg` separately, with no URL, so a caller that has a form on
    screen to walk (validate_script/) can flag the actual offending field
    instead of just showing the summary.
    """
    errors = [{"loc": list(err["loc"]), "msg": err["msg"]} for err in e.errors(include_url=False)]
    summary = errors[0]["msg"] if len(errors) == 1 else f"{len(errors)} field(s) need attention"
    return summary, errors


def _modules_implementing(classes: list[dict[str, str]], interfaces: list[type[Interface]]) -> set[str]:
    """Module names among `classes` (`webadmin.get_module_classes()`'s fleet-aggregated list, issue
    #119) that have at least one row whose resolved class implements every interface in
    `interfaces` at once (AND semantics per row, mirroring the frontend's own intersection in
    schemaform.js's buildModuleRefControl for fields that need more than one interface at once,
    e.g. DarkBiasScript.camera).

    A module name can appear once per host; a name qualifies if *any* of its rows satisfies all
    required interfaces together (OR across rows) -- checking per-interface across different rows
    instead would let two different hosts' distinct capabilities be mixed together as if they
    belonged to one module, which they don't.
    """
    allowed: set[str] = set()
    for entry in classes:
        try:
            cls = get_class_from_string(entry["class"])
        except Exception:
            continue
        if inspect.isclass(cls) and all(issubclass(cls, iface) for iface in interfaces):
            allowed.add(entry["name"])
    return allowed


def _collect_module_ref_errors(
    obj: Any, loc: list[Any], classes: list[dict[str, str]], errors: list[dict[str, Any]]
) -> None:
    """Recursively walk a validated `Script` instance tree, flagging every module-ref field
    (`Annotated[str, SomeInterface]`, issue #98) whose value isn't a module `classes` says
    implements every interface the field requires. Errors use the same `{loc, msg}` shape as
    `_summarize_validation_error`, so they flow through the existing field-error plumbing
    (ScriptBuilder._applyFieldErrors) and mark the offending `<select>` `.is-invalid` exactly
    like any other field error, with no extra frontend wiring needed.

    A required field left empty is flagged here too, with the same "Field required" message
    pydantic itself would use: the builder's `<select>` always submits the key (empty string for
    its blank placeholder option, never an absence), so pydantic's own required-field check never
    sees a missing key to complain about -- this is the only thing that actually catches it.

    Only ever called with a non-None `classes` -- an unreachable/unconfigured web-admin must
    never block saving a script (module_ref_options() degrades to a free-text input in that
    case; passing an empty list here would instead reject every module-ref value outright).
    """
    if isinstance(obj, BaseModel):
        for field_name, field_info in type(obj).model_fields.items():
            if field_name in IGNORED_FIELDS:
                continue
            value = getattr(obj, field_name, None)
            field_loc = loc + [field_name]
            interfaces = [m for m in field_info.metadata if inspect.isclass(m) and issubclass(m, Interface)]
            if interfaces:
                if isinstance(value, str) and value:
                    if value not in _modules_implementing(classes, interfaces):
                        names = " + ".join(i.__name__ for i in interfaces)
                        errors.append(
                            {"loc": field_loc, "msg": f"'{value}' is not a configured module implementing {names}"}
                        )
                elif not value and field_info.is_required():
                    errors.append({"loc": field_loc, "msg": "Field required"})
                continue
            _collect_module_ref_errors(value, field_loc, classes, errors)
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            _collect_module_ref_errors(item, loc + [i], classes, errors)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            _collect_module_ref_errors(v, loc + [k], classes, errors)


def validate_script(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {"valid": False, "error": "Script must be a YAML/JSON object."}
    error = _check_no_classless_nodes(data)
    if error is not None:
        return {"valid": False, "error": error}
    try:
        script = Script.model_validate(data)
    except (ImportError, AttributeError):
        return {"valid": False, "error": f"unknown script class '{data.get('class')}'"}
    except ValidationError as e:
        summary, errors = _summarize_validation_error(e)
        return {"valid": False, "error": summary, "errors": errors}
    except Exception as e:
        return {"valid": False, "error": str(e)}

    classes = webadmin.get_module_classes()
    if classes is not None:
        module_ref_errors: list[dict[str, Any]] = []
        _collect_module_ref_errors(script, [], classes, module_ref_errors)
        if module_ref_errors:
            summary = (
                module_ref_errors[0]["msg"]
                if len(module_ref_errors) == 1
                else f"{len(module_ref_errors)} field(s) need attention"
            )
            return {"valid": False, "error": summary, "errors": module_ref_errors}
    return {"valid": True}


def estimate_duration(data: Any) -> dict[str, Any]:
    """Estimate the duration of a script, given the full task payload.

    The full task dict (not just the script sub-dict) must be passed so that
    scripts like TransitImagingScript can find their TransitMerit and return
    the correct window duration rather than falling back to the base
    ImagingScript calculation (which only sums exposure times).
    """
    if not isinstance(data, dict):
        return {"error": "Script must be a YAML/JSON object."}
    try:
        # If the caller passed the full task dict, validate the whole task
        # and create the script from it so estimate_duration gets TaskData.
        if "script" in data and isinstance(data["script"], dict):
            from pyobs.robotic.task import Task, TaskData

            # target ra/dec may arrive as hms/dms strings; strip them so
            # Task.model_validate doesn't choke (the scheduler converts them
            # at runtime; we only need merits here).
            task_dict = {k: v for k, v in data.items() if k != "target"}
            task = Task.model_validate(task_dict)
            script = task.create_script()
            return {"duration": script.estimate_duration(data=TaskData(task=task), time=None)}
        else:
            # Legacy: called with just the script dict.
            script = Script.model_validate(data)
            return {"duration": script.estimate_duration()}
    except ValidationError as e:
        # issue #102: same raw-pydantic-dump problem as validate_script/ --
        # this runs on every script edit now (issue #96's auto-estimate), so
        # an in-progress/incomplete script would otherwise show it constantly.
        # No form on screen to flag a field against here, just the summary.
        summary, _ = _summarize_validation_error(e)
        return {"error": summary}
    except Exception as e:
        return {"error": str(e)}
