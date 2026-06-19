import paramiko
import time
import os
import tarfile

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

print('=== Deploying Admin UI (correct repo) ===')

# 1. Stop container
print('Stopping teko-verify...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && docker compose stop teko-verify 2>&1')
print(stdout.read().decode())

# 2. Clean old dist
print('Cleaning old dist...')
stdin, stdout, stderr = ssh.exec_command('rm -rf /home/soporte/teko/admin/dist && mkdir -p /home/soporte/teko/admin/dist')

# 3. Create tar.gz from correct build
print('Creating tar.gz...')
tar_path = 'C:\\Users\\sotelos\\teko\\admin_dist.tar.gz'
with tarfile.open(tar_path, 'w:gz') as tar:
    tar.add('C:\\Users\\sotelos\\teko\\admin\\dist', arcname='dist')

sftp = ssh.open_sftp()
sftp.put(tar_path, '/tmp/admin_dist.tar.gz')
sftp.close()
os.remove(tar_path)

print('Extracting on server...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && tar xzf /tmp/admin_dist.tar.gz -C /home/soporte/teko/admin/dist/ --strip-components=1 && rm /tmp/admin_dist.tar.gz')
print(stdout.read().decode() + stderr.read().decode())

# 4. Verify
stdin, stdout, stderr = ssh.exec_command('head -12 /home/soporte/teko/admin/dist/index.html')
print('\nindex.html:')
print(stdout.read().decode())

# 5. Start container
print('Starting teko-verify...')
stdin, stdout, stderr = ssh.exec_command('cd /home/soporte/teko && docker compose up -d --no-build 2>&1')
print(stdout.read().decode())

time.sleep(15)

# 6. Verify
stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/assets/index-DjXCxgyf.css 2>/dev/null | grep -i content-type')
print('CSS Content-Type:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('docker logs teko-teko-verify-1 --tail 3 2>&1')
print('Server logs:', stdout.read().decode())

ssh.close()
print('\n=== DEPLOY COMPLETE ===')
