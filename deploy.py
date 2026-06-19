import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Check what the main bundle references
stdin, stdout, stderr = ssh.exec_command('curl -s http://localhost:4400/admin-ui/assets/index-C_CWZ6cR.js 2>/dev/null | grep -o "UserProfileDropdown-[a-zA-Z0-9_-]*\\.js" | head -1')
print('Main bundle references:', stdout.read().decode())

ssh.close()
