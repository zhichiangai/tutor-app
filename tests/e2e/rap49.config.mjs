// RAP-49 true Chromium + disposable local GoTrue/Auth student acceptance.
import {defineConfig} from '@playwright/test';
import base from './rap12.config.mjs';

export default defineConfig({
 ...base,
 testMatch:['rap49-student-gui.spec.mjs'],
 workers:1,
 fullyParallel:false,
 reporter:[['list'],['html',{outputFolder:'test-results/rap49-e2e-report',open:'never'}]],
 outputDir:'test-results/rap49-e2e-artifacts',
 use:{...base.use,screenshot:'off',trace:'off'},
});
