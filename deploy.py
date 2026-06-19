import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Check what UserProfileDropdown bundle is referenced in index.html
stdin, stdout, stderr = ssh.exec_command('grep -o "UserProfileDropdown-[a-zA-Z0-9_-]*\\.js" /home/soporte/teko/admin/dist/index.html')
print('index.html ref:', stdout.read().decode())

# Check what UserProfileDropdown bundles exist
stdin, stdout, stderr = ssh.exec_command('ls /home/soporte/teko/admin/dist/assets/ | grep -i "userprofile"')
print('Available bundles:', stdout.read().decode())

# Check if the old bundle still exists
stdin, stdout, stderr = ssh.exec_command('ls -la /home/soporte/teko/admin/dist/assets/UserProfileDropdown-*')
print('All UserProfileDropdown files:', stdout.read().decode())

# Check the server-side code - what does server.ts serve
stdin, stdout, stderr = ssh.exec_command('docker exec teko-teko-verify-1 ls /app/admin/dist/assets/ | grep -i "userprofile"')
print('Container sees:', stdout.read().decode())

ssh.close()
