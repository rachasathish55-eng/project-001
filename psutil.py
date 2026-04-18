from __future__ import annotations

import os
import time
from collections import namedtuple


svmem = namedtuple("svmem", "total available percent used free")
_last_cpu_sample: tuple[float, float] | None = None


def _read_proc_stat() -> tuple[float, float]:
    with open("/proc/stat", "r", encoding="utf-8") as handle:
        first = handle.readline().split()
    values = list(map(float, first[1:]))
    idle = values[3] + values[4]
    total = sum(values)
    return total, idle


def cpu_percent(interval: float | None = None) -> float:
    global _last_cpu_sample
    if interval is not None:
        time.sleep(interval)
    current = _read_proc_stat()
    if _last_cpu_sample is None:
        _last_cpu_sample = current
        return 0.0
    prev_total, prev_idle = _last_cpu_sample
    total, idle = current
    _last_cpu_sample = current
    total_delta = total - prev_total
    idle_delta = idle - prev_idle
    if total_delta <= 0:
        return 0.0
    return max(0.0, min(100.0, (1.0 - idle_delta / total_delta) * 100.0))


def virtual_memory() -> svmem:
    info: dict[str, float] = {}
    with open("/proc/meminfo", "r", encoding="utf-8") as handle:
        for line in handle:
            name, value, *_ = line.split()
            info[name.rstrip(":")] = float(value) * 1024.0
    total = info.get("MemTotal", 0.0)
    available = info.get("MemAvailable", info.get("MemFree", 0.0))
    used = max(0.0, total - available)
    percent = (used / total * 100.0) if total else 0.0
    free = info.get("MemFree", available)
    return svmem(int(total), int(available), percent, int(used), int(free))
