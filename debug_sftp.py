import paramiko, os
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Check where SFTP is uploading
sftp = ssh.open_sftp()
print('SFTP remote pwd:', sftp.normalize('.'))

# Upload a test file
sftp.put('C:\\Users\\sotelos\\RWS-CRM\\demo\\build\\index.html', 'index_test.html')
print('Uploaded to:', sftp.normalize('index_test.html'))

# Check where it went
stdin, stdout, stderr = ssh.exec_command('find /home/soporte/teko -name "index_test.html" 2>/dev/null')
print('Found at:', stdout.read().decode())

stdin, stdout, stderr = ssh.exec_command('ls -la /home/soporte/teko/admin/dist/index.html 2>/dev/null')
print('In admin/dist:', stdout.read().decode())

# Clean up
try:
    sftp.remove('index_test.html')
except:
    pass

# Now try uploading to admin/dist directly
print('\n--- Direct upload to admin/dist ---')
sftp.put('C:\\Users\\sotelos\\RWS-CRM\\demo\\build\\index.html', '/home/soporte/teko/admin/dist/index.html')
stdin, stdout, stderr = ssh.exec_command('ls -la /home/soporte/teko/admin/dist/index.html')
print('After direct upload:', stdout.read().decode())

# Create assets dir via shell
stdin, stdout, stderr = ssh.exec_command('mkdir -p /home/soporte/teko/admin/dist/assets')
print('Created assets dir')

# Upload assets
build = 'C:\\Users\\sotelos\\RWS-CRM\\demo\\build\\assets'
for f in sorted(os.listdir(build))[:5]:
    sftp.put(os.path.join(build, f), f'/home/soporte/teko/admin/dist/assets/{f}')
    
stdin, stdout, stderr = ssh.exec_command('ls /home/soporte/teko/admin/dist/assets/ | head -5')
print('Assets:', stdout.read().decode())

sftp.close()
ssh.close()
