'use strict';
const path=require('node:path'),{report}=require('./MANTIX_dashboard_datos');
module.exports=function(app,{pool,auth,permit}){
 const guard=[auth,permit('dashboard.leer')];
 app.get('/dashboard',...guard,(req,res)=>res.sendFile(path.join(__dirname,'MANTIX_dashboard.html')));
 app.get('/dashboard-export.js',...guard,(req,res)=>res.sendFile(path.join(__dirname,'MANTIX_dashboard_export.js')));
 app.get('/api/dashboard',...guard,async(req,res)=>{try{res.json({ok:true,...await report(pool,req.query)});}catch(e){console.error('[Dashboard]',e.message);res.status(e.status||503).json({ok:false,error:e.status?e.message:'No se pudo consultar el Dashboard. Revisa la terminal.'});}});
};
