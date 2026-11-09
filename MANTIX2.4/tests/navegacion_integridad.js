'use strict';
const fs=require('fs'), path=require('path'), cp=require('child_process');
const base=path.join(__dirname,'..','tools');
const pages=fs.readdirSync(base).filter(f=>f.endsWith('.html'));
const server=fs.readFileSync(path.join(base,'MANTIX_servidor_acceso_local.js'),'utf8');
const modules=fs.readFileSync(path.join(base,'MANTIX_modulos_completos.js'),'utf8');
const revision=fs.readFileSync(path.join(base,'MANTIX_revision.js'),'utf8');
const dashboard=fs.readFileSync(path.join(base,'MANTIX_dashboard.js'),'utf8');
const routes=new Set(['/', '/centro','/bitacora','/historial','/revision','/preventivos','/dashboard','/turnos','/catalogos','/auditoria','/correcciones','/ejecucion','/pendientes','/administracion/usuarios']);
let count=0;
for(const page of pages){
 const html=fs.readFileSync(path.join(base,page),'utf8');
 for(const match of html.matchAll(/\bhref=["'](\/[^"']*)["']/g)){
  if(!match[1].startsWith('//')){
   const pathname=new URL(match[1],'http://localhost').pathname;
   if(!routes.has(pathname))throw Error(`Ruta no registrada ${match[1]} en ${page}`);
   if(pathname!=='/' && !(server+modules+revision+dashboard).includes(`'${pathname}'`))throw Error(`Ruta sin controlador ${match[1]}`);
   count++;
  }
 }
 const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
 for(const [i,script] of scripts.entries()){
  const out=cp.spawnSync('node',['--check','-'],{input:script[1],encoding:'utf8'});
  if(out.status!==0)throw Error(`${page}, script ${i}: ${out.stderr}`);
 }
}
const ej=fs.readFileSync(path.join(base,'MANTIX_ejecucion.html'),'utf8');
const pe=fs.readFileSync(path.join(base,'MANTIX_pendientes.html'),'utf8');
const ce=fs.readFileSync(path.join(base,'MANTIX_centro.html'),'utf8');
if(ej.includes('Guardar en PostgreSQL')||pe.includes('Centro de Control</a>')||ej.includes('Centro de Control</a>')||!ce.includes('function contextualNav'))throw Error('Revisión de interfaz incompleta');
console.log(`OK: ${pages.length} páginas y ${count} enlaces internos a rutas existentes. JavaScript embebido válido.`);
console.log('Control estático; la validación contra PostgreSQL se hace en Laragon.');
