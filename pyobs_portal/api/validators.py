import math
from django.core.exceptions import ValidationError


def validate_finite(value):
    if not math.isfinite(value):
        raise ValidationError("Priority must be a finite number.", code="not_finite")
