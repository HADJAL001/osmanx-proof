// R4 deployment eligibility checklist. Does NOT publish a service or certify compliance.
const secret=raw=>typeof raw==='string'&&raw.length>=32;
export function releaseGate(env=process.env,evidence={}){
 const errors=[];
 if(env.NODE_ENV!=='production')errors.push('NODE_ENV must be production for staging infrastructure');
 if(!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(env.APP_ORIGIN||''))errors.push('External APP_ORIGIN must be HTTPS');
 if(!secret(env.IP_HASH_SECRET)||!secret(env.METRICS_SECRET))errors.push('Session risk and metrics secrets are missing');
 if(!secret(env.MAIL_DELIVERY_SECRET)&&env.MAIL_DELIVERY_URL)errors.push('Mail delivery requires signed secret');
 if(env.PAYMENT_MODE!=='disabled')errors.push('Public deployment must not use unreviewed payments');
 if(env.PAYOUTS_ENABLED==='1')errors.push('Payouts are not production approved');
 if(env.EMAIL_TEST_MODE==='1')errors.push('Test email must be disabled');
 if(env.STRIPE_TEST_SECRET_KEY||env.STRIPE_TEST_WEBHOOK_SECRET)errors.push('Test Stripe secrets not allowed in public staging');
 const backupKey=typeof env.BACKUP_ENCRYPTION_KEY==='string'?Buffer.from(env.BACKUP_ENCRYPTION_KEY,'base64'):Buffer.alloc(0);
 if(backupKey.length!==32)errors.push('Valid 256-bit encrypted backup key missing');
 if(!env.OFFSITE_BACKUP_DESTINATION)errors.push('Offsite backup destination not configured');
 if(env.TLS_TERMINATION_VERIFIED!=='1')errors.push('TLS termination not verified');
 if(evidence.nodeTestsPassed!==true)errors.push('Current source test evidence missing');
 if(evidence.browserE2EPassed!==true)errors.push('Live browser E2E evidence missing');
 if(evidence.postgresRlSVerified!==true)errors.push('Live PostgreSQL tenant RLS verification missing');
 if(evidence.backupRestoreVerified!==true)errors.push('Backup restore proof missing');
 if(evidence.securityReviewPassed!==true)errors.push('Independent security review missing');
 return {release:'R4',eligible:errors.length===0,errors,realPaymentsEnabled:false,realPayoutsEnabled:false};
}
if(process.argv[1]?.endsWith('r4-release-gate.mjs')){
 console.log(JSON.stringify(releaseGate(),null,2));
 process.exitCode=1; // CLI requires a signed/approved evidence file in a later release.
}
