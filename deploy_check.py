import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Verify CSS serves correctly
stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/assets/index-D258vUK8.css 2>/dev/null | grep -i content-type')
print('CSS:', stdout.read().decode())

# Verify JS serves correctly
stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/assets/index-Bkwi16Gj.js 2>/dev/null | grep -i content-type')
print('JS:', stdout.read().decode())

# Verify no PiPhoneDuotone reference in main bundle
stdin, stdout, stderr = ssh.exec_command('curl -s http://localhost:4400/admin-ui/assets/index-Bkwi16Gj.js 2>/dev/null | grep -c "PiPhoneDuotone"')
print('PiPhoneDuotone refs:', stdout.read().decode())

# Verify admin-ui root
stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin-ui/ 2>/dev/null | head -5')
print('Admin UI:', stdout.read().decode())

# Health
stdin, stdout, stderr = ssh.exec_command('curl -s http://localhost:4400/health')
print('Health:', stdout.read().decode())

ssh.close()