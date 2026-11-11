'use strict';
// Solo prepara archivos para traslado. No inicia el servidor ni accede a PostgreSQL.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),destination=path.join(root,'dist','mantix-servidor.tar.gz');
const required=['tools','public','database','docs','scripts','README.md','.env.example','package.json','package-lock.json'];
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'mantix-paquete-'));
try{
 const stage=path.join(temporary,'MANTIX');fs.mkdirSync(stage);
 for(const name of required){const source=path.join(root,name);if(!fs.existsSync(source))throw Error('Falta el archivo o carpeta requerida: '+name);fs.cpSync(source,path.join(stage,name),{recursive:true});}
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 execFileSync('tar',['-czf',destination,'-C',temporary,'MANTIX'],{stdio:'inherit'});
 console.log('Paquete preparado: '+destination);
 console.log('Incluye package-lock.json; no incluye node_modules, pruebas, respaldos ni secretos.');
}catch(e){console.error('No se pudo preparar el paquete: '+e.message);process.exitCode=1;}
finally{fs.rmSync(temporary,{recursive:true,force:true});}
