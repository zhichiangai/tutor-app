import {defineConfig} from '@playwright/test';

export default defineConfig({
 testDir:'.',
 testMatch:'v4-browser.spec.mjs',
 timeout:60_000,
 expect:{timeout:25_000},
 fullyParallel:false,
 workers:1,
 retries:0,
 reporter:[['list'],['html',{outputFolder:'test-results/v4-e2e-report',open:'never'}]],
 outputDir:'test-results/v4-e2e-artifacts',
 use:{
  baseURL:'http://127.0.0.1:3000',
  timezoneId:'Asia/Taipei',
  headless:true,
  trace:'off',
  screenshot:'only-on-failure',
  viewport:{width:1280,height:800}
 },
 webServer:{
  command:'python3 -m http.server 3000 --bind 127.0.0.1',
  url:'http://127.0.0.1:3000/v2/index.html',
  timeout:30_000,
  reuseExistingServer:false
 }
});
