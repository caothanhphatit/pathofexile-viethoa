"""Read-only regression check: release PE must be a GUI executable."""
import struct
import sys
from pathlib import Path

path = Path(sys.argv[1])
with path.open('rb') as binary:
    assert binary.read(2) == b'MZ', 'Not a PE executable'
    binary.seek(0x3C)
    offset = struct.unpack('<I', binary.read(4))[0]
    binary.seek(offset)
    assert binary.read(4) == b'PE\0\0', 'Invalid PE signature'
    binary.seek(offset + 24 + 68)
    subsystem = struct.unpack('<H', binary.read(2))[0]
assert subsystem == 2, f'Expected Windows GUI subsystem 2, found {subsystem}: {path}'
print(f'PASS: {path.name} uses Windows GUI subsystem (no startup console)')
