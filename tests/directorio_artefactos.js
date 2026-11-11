'use strict';
const path=require('node:path');
module.exports=path.resolve(process.env.MANTIX_ARTIFACTS_DIR||path.join(__dirname,'../artifacts'));
