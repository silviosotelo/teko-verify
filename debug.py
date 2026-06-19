import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Check server logs for 502 errors
stdin, stdout, stderr = ssh.exec_command('docker logs teko-teko-verify-1 --tail 40 2>&1 | grep -i "error\\|502\\|usage\\|analytics"')
print('Errors:', stdout.read().decode())

# Check if the ocr sidecar is down
stdin, stdout, stderr = ssh.exec_command('curl -s http://localhost:8001/health 2>/dev/null || echo "OCR sidecar unreachable"')
print('OCR health:', stdout.read().decode())

# Check the usage endpoint directly
stdin, stdout, stderr = ssh.exec_command('curl -sI http://localhost:4400/admin/tenants/078584d2-f09a-4548-8fa2-3af8e52651b0/usage 2>/dev/null')
print('Usage headers:', stdout.read().decode())

ssh.close()