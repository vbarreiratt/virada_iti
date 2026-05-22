import http.server
import socketserver
import os

PORT = 8000
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

# Avoid port already in use errors
socketserver.TCPServer.allow_reuse_address = True

print(f"Iniciando servidor local na porta {PORT}...")
print(f"Diretório hospedado: {DIRECTORY}")

try:
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Servidor rodando! Abra no navegador: http://localhost:{PORT}")
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServidor encerrado.")
except Exception as e:
    print(f"Erro ao iniciar o servidor: {e}")
