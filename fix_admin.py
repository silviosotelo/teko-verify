import paramiko
import time

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Fixing Admin Dist ===')

# Write a Python fix script to the host
script = r'''
import os
import shutil

base = '/home/soporte/teko/admin/dist'
backslash = chr(92)
for f in os.listdir(base):
    if backslash in f or '/' in f:
        parts = f.replace(backslash, '/').split('/')
        if len(parts) > 1:
            src = os.path.join(base, f)
            dst_dir = os.path.join(base, parts[0])
            dst = os.path.join(dst_dir, parts[1])
            os.makedirs(dst_dir, exist_ok=True)
            shutil.move(src, dst)
            print(f'Moved: {f}')
print('DONE')
'''

stdin, stdout, stderr = ssh.exec_command(f'echo "{script}" > /tmp/fix_admin.py && python3 /tmp/fix_admin.py')
output = stdout.read().decode()
print(output[:1000])

# Verify
stdin, stdout, stderr = ssh.exec_command('ls /home/soporte/teko/admin/dist/assets/ | wc -l')
print(f'\nFiles in assets: {stdout.read().decode()}')

stdin, stdout, stderr = ssh.exec_command('ls /home/soporte/teko/admin/dist/assets/*.css 2>/dev/null | head -5')
print(f'CSS files: {stdout.read().decode()}')

# Restart
print('\nRestarting...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && docker compose restart teko-verify')
print(stdout.read().decode())

time.sleep(20)

stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/assets/index-DjXCxgyf.css 2>/dev/null | grep -i content-type')
print(f'Content-Type: {stdout.read().decode()}')

ssh.close()
