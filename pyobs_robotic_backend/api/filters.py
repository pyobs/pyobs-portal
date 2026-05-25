import django_filters
from django.utils import timezone
from astropy.time import Time
from .models import Observation


class AstropyDateTimeFilter(django_filters.CharFilter):
    """Custom filter that accepts astropy-style ISO datetime strings."""

    def filter(self, qs, value):
        if not value:
            return qs
        tz = timezone.get_current_timezone()
        dt = Time(value).to_datetime(tz)
        return qs.filter(**{f"{self.field_name}__{self.lookup_expr}": dt})


class ObservationFilter(django_filters.FilterSet):
    task = django_filters.NumberFilter(field_name="task_id")
    start_before = AstropyDateTimeFilter(field_name="start", lookup_expr="lte")
    start_after = AstropyDateTimeFilter(field_name="start", lookup_expr="gte")
    end_before = AstropyDateTimeFilter(field_name="end", lookup_expr="lte")
    end_after = AstropyDateTimeFilter(field_name="end", lookup_expr="gte")
    state = django_filters.CharFilter(method="filter_state")

    def filter_state(self, queryset, name, value):
        states = [s.strip() for s in value.split(",")]
        return queryset.filter(state__in=states)

    class Meta:
        model = Observation
        fields = ["task", "state"]
