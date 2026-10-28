import os, pty, sys, time, select, struct, fcntl, termios, json

out_path, cwd, cols, rows = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
steps = json.loads(sys.argv[5])
cmd = sys.argv[6:]

pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.environ.update(TERM='xterm-256color', COLORTERM='truecolor', COLUMNS=str(cols), LINES=str(rows))
    os.execvp(cmd[0], cmd)

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
buf = bytearray()

def pump(seconds):
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try:
                data = os.read(fd, 65536)
            except OSError:
                return False
            if not data:
                return False
            buf.extend(data)
            if b'\x1b[6n' in data:
                os.write(fd, f'\x1b[{rows};1R'.encode())
    return True

for wait, keys in steps:
    if not pump(wait):
        break
    if keys:
        os.write(fd, keys.encode())
pump(1)
open(out_path, 'wb').write(bytes(buf))
try:
    os.kill(pid, 9)
except ProcessLookupError:
    pass
print(len(buf), 'bytes')
