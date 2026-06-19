import paramiko
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('192.168.41.34', username='soporte', password='Soporte24', timeout=10)

sid = "78502b26-3707-475c-bafb-feadac1b248b"

stdin, stdout, stderr = ssh.exec_command(
    f'docker exec teko-postgres-1 psql -U teko -d teko -c "SELECT * FROM verification_sessions WHERE id = \'{sid}\';" 2>&1'
)
print('Session details:')
import sys
sys.stdout.buffer.write(stdout.read())

stdin, stdout, stderr = ssh.exec_command(
    f'docker exec teko-postgres-1 psql -U teko -d teko -c "SELECT * FROM verification_checks WHERE session_id = \'{sid}\' ORDER BY checked_at;" 2>&1'
)
print('\nChecks:')
sys.stdout.buffer.write(stdout.read())

stdin, stdout, stderr = ssh.exec_command(
    f'docker exec teko-postgres-1 psql -U teko -d teko -c "SELECT * FROM evidence WHERE session_id = \'{sid}\' ORDER BY created_at;" 2>&1'
)
print('\nEvidence:')
sys.stdout.buffer.write(stdout.read())

stdin, stdout, stderr = ssh.exec_command(
    f'docker exec teko-postgres-1 psql -U teko -d teko -c "SELECT * FROM session_events WHERE session_id = \'{sid}\' ORDER BY created_at;" 2>&1'
)
print('\nEvents:')
sys.stdout.buffer.write(stdout.read())

ssh.close()