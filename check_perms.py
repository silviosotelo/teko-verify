import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

stdin, stdout, stderr = ssh.exec_command('touch /home/soporte/teko/admin/dist/test.txt 2>&1 && echo OK || echo FAIL')
print('Write test:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('ls -la /home/soporte/teko/admin/dist/test.txt 2>/dev/null')
print('File exists:', stdout.read().decode())

# Try uploading a single file via SFTP
sftp = ssh.open_sftp()
try:
    sftp.put('C:\\Users\\sotelos\\RWS-CRM\\demo\\build\\index.html', '/home/soporte/teko/admin/dist/index.html')
    print('SFTP upload: SUCCESS')
except Exception as e:
    print(f'SFTP upload FAILED: {e}')
sftp.close()

stdin, stdout, stderr = ssh.exec_command('ls -la /home/soporte/teko/admin/dist/index.html 2>/dev/null')
print('After SFTP:', stdout.read().decode())

ssh.close()
