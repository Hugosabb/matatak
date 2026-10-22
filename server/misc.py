def time_control_str(base, inc, byo, day=0):
    if day > 0:
        return f"{day} day" if day == 1 else f"{day} days"

    if base == 0 and inc == 0 and byo == 0:
        return "Sans limite"

    if base == 1 / 4:
        base = "¼"
    elif base == 1 / 2:
        base = "½"
    elif base == 3 / 4:
        base = "¾"
    else:
        base = str(int(base))
    if byo == 0:
        inc_str = f"{inc}"
    elif byo == 1:
        inc_str = f"{inc}(b)"
    else:
        inc_str = f"{byo}x{inc}(b)"
    return base + "+" + inc_str
