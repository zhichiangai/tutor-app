// RAP-12 isolated browser QA: separate fixture and report from the existing V4 suite.
import {defineConfig} from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
 ...base,
 testMatch:['rap12-team-gui.spec.mjs'],
 fullyParallel:false,
 workers:1,
 reporter:[['list'],['html',{outputFolder:'test-results/rap12-e2e-report',open:'never'}]],
 outputDir:'test-results/rap12-e2e-artifacts',
 use:{...base.use,screenshot:'off',trace:'off'},
});
