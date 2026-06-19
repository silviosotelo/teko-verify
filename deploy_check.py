import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

# Check kernel APIs icon in UserProfileDropdown
stdin, stdout, stderr = ssh.exec_command("grep -o 'PiPhoneDuotone' /home/soporte/teko/admin/dist/assets/UserProfileDropdown-CEGWqDUP.js")
print('PiPhoneDuotone in UserProfile:', stdout.read().decode()[:80])

# Check if the ApiKeys chunk has new features
stdin, stdout, stderr = ssh.exec_command("grep -o 'createOpen' /home/soporte/teko/admin/dist/assets/index-C9dS2LYI.js")
print('createOpen:', stdout.read().decode()[:80])

# Check if the main bundle has Compliance
stdin, stdout, stderr = ssh.exec_command("grep -o 'Compliance' /home/soporte/teko/admin/dist/assets/index-CTo-yjRk.js")
print('Compliance:', stdout.read().decode()[:80])

# Check CSS serving
stdin, stdout, stderr = ssh.exec_command("curl -sI http://localhost:4400/admin-ui/assets/index-DpQx0XEH.css 2>/dev/null | grep -i 'content-type'")
print('CSS content-type:', stdout.read().decode())

# Check JS serving  
stdin, stdout, stderr = ssh.exec_command("curl -sI http://localhost:4400/admin-ui/assets/index-CTo-yjRk.js 2>/dev/null | grep -i 'content-type'")
print('JS content-type:', stdout.read().decode())

ssh.close()
print('DONE')