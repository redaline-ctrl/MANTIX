from pathlib import Path
from bs4 import BeautifulSoup
import re, subprocess, tempfile
root=Path(__file__).resolve().parents[1]
tools=root/'tools'
htmls=list(tools.glob('*.html'))
assert len(htmls)>=6
routes={'/centro','/bitacora','/historial','/revision','/preventivos','/dashboard','/turnos','/catalogos','/auditoria','/correcciones','/ejecucion','/pendientes','/administracion/usuarios','/'}
server=(tools/'MANTIX_servidor_acceso_local.js').read_text()
modules=(tools/'MANTIX_modulos_completos.js').read_text()
for route in routes-{'/'}:
 assert f"'{route}'" in server+modules,route
checked=0
for p in htmls:
 soup=BeautifulSoup(p.read_text(),'html.parser')
 for a in soup.find_all('a',href=True):
  href=a['href']
  if href.startswith('/') and not href.startswith('//'):
   assert href in routes,(p.name,href)
   checked+=1
 for script in soup.find_all('script'):
  if script.get('src') or not script.string:continue
  f=tempfile.NamedTemporaryFile(suffix='.js',delete=False)
  f.write(script.string.encode());f.close()
  r=subprocess.run(['node','--check',f.name],capture_output=True,text=True)
  Path(f.name).unlink()
  assert r.returncode==0,(p.name,r.stderr)
assert 'Guardar en PostgreSQL' not in (tools/'MANTIX_ejecucion.html').read_text()
assert 'Centro de Control</a>' not in (tools/'MANTIX_ejecucion.html').read_text()
assert 'Centro de Control</a>' not in (tools/'MANTIX_pendientes.html').read_text()
assert 'function contextualNav' in (tools/'MANTIX_centro.html').read_text()
assert "$('bcargar').onclick=load" in (tools/'MANTIX_centro.html').read_text()
print(f'OK: {len(htmls)} páginas; {checked} enlaces internos apuntan a rutas reales; JavaScript embebido válido; sin enlaces repetidos en Ejecución/Pendientes.')
print('Verificación estática: requiere prueba funcional en PostgreSQL local para validar operaciones de escritura.')
