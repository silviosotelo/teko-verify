import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Check OCR sidecar logs
stdin, stdout, stderr = ssh.exec_command('docker logs teko-paddleocr-sidecar-1 --tail 20 2>&1')
print('OCR logs:')
print(stdout.read().decode())

# Check if it's listening
stdin, stdout, stderr = ssh.exec_command('docker exec teko-paddleocr-sidecar-1 curl -s http://localhost:8001/health 2>&1 || echo "sidecar internal check failed"')
print('Internal health:', stdout.read().decode())

ssh.close()