import paramiko
import time
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Rebuild admin dist on server ===')

# 1. Stop container
print('Stopping...')
ssh.exec_command('cd /home/soporte/teko && docker compose stop teko-verify 2>&1')

# 2. Install deps if needed
print('Checking node_modules...')
s = ssh.exec_command('test -d /home/soporte/teko/admin/node_modules && echo YES || echo NO')
if 'NO' in s[1].read().decode():
    print('Installing npm deps...')
    ssh.exec_command('cd /home/soporte/teko/admin && npm install 2>&1 | tail -3')

# 3. Rebuild admin
print('Building admin...')
s = ssh.exec_command('cd /home/soporte/teko/admin && npm run build 2>&1')
import sys
sys.stdout.buffer.write(s[1].read())

# 4. Verify new bundle
s = ssh.exec_command('grep -o "UserProfileDropdown-[a-zA-Z0-9_-]*\\.js" /home/soporte/teko/admin/dist/index.html')
print('\nindex.html ref:', s[1].read().decode())

s = ssh.exec_command('ls /home/soporte/teko/admin/dist/assets/ | grep -i "userprofile"')
print('Bundles:', s[1].read().decode())

# 5. Start container
print('Starting...')
ssh.exec_command('cd /home/soporte/teko && docker compose up -d teko-verify 2>&1')

time.sleep(15)

# 6. Verify
s = ssh.exec_command('docker logs teko-teko-verify-1 --tail 3 2>&1')
print('Logs:', s[1].read().decode())

s = ssh.exec_command('curl -s http://localhost:4400/health')
print('Health:', s[1].read().decode())

ssh.close()
print('DONE')
