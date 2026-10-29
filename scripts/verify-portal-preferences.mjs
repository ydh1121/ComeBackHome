import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ appType:'custom',logLevel:'error',server:{middlewareMode:true} });
let checks=0;
const same=(actual,expected,note)=>{assert.deepEqual(actual,expected,note);checks++;};
try {
  const {favoriteActions,defaultFavoritePreferences,favoriteStorageKey,parseFavoritePreferences,serializeFavoritePreferences,portalHasPrivateShell,portalHasBottomNavigation}=await server.ssrLoadModule('/src/modules/portal/favorites.ts');
  const defaults=defaultFavoritePreferences();
  for(const raw of [null,'','{broken','null','{}','[1]','["missing"]','{"version":2,"visible":false,"ids":[]}']) same(parseFavoritePreferences(raw),defaults,'invalid saved preferences recover');
  same(parseFavoritePreferences('["schedule","note","schedule","retired"]'),{visible:true,ids:['schedule','note']},'legacy array preserves selection/order and removes unknown/duplicate ids');
  same(parseFavoritePreferences('[]'),{visible:true,ids:[]},'intentionally empty legacy selection stays empty');
  for(const value of [{visible:false,ids:['account','income','note']},{visible:true,ids:[]},{visible:false,ids:[]}]) same(parseFavoritePreferences(serializeFavoritePreferences(value)),value,'visibility and choices round-trip independently');
  assert.notEqual(favoriteStorageKey('synthetic-one'),favoriteStorageKey('synthetic-two'));checks++;
  same(new Set(favoriteActions.map(action=>action.id)).size,favoriteActions.length,'action ids unique');
  const {productRoutes}=await server.ssrLoadModule('/src/application/route-manifest.ts');
  const households=new Set(['cards','ledger','income','notes']);
  const injuries=new Set(['today','progress','library','manage']);
  for(const action of favoriteActions){
    const url=new URL(action.href,'https://synthetic.invalid');
    same(url.origin,'https://synthetic.invalid','every favorite stays within product');
    if(url.pathname==='/household')assert(households.has(url.searchParams.get('section')));
    else if(url.pathname==='/injury')assert(injuries.has(url.searchParams.get('section')));
    else assert(productRoutes.includes(url.pathname)||url.pathname==='/account');
    checks++;
  }
  for(const path of ['/account','/settings/favorites','/household','/household/deep','/injury'])same(portalHasPrivateShell(path),true,'private status edge includes account/settings');
  for(const path of ['/','/schedule','/settings','/import','/people','/household-unknown'])same(portalHasPrivateShell(path),false,'accepted schedule edge unchanged');
  for(const path of ['/account','/settings/favorites'])same(portalHasBottomNavigation(path),false,'dock-free settings use lower favorite position');
  for(const path of ['/','/schedule','/settings','/injury','/household'])same(portalHasBottomNavigation(path),true,'existing module docks retain offset');
  const router=await readFile('src/app/router.tsx','utf8');
  assert(router.indexOf("path: '/settings/favorites'")<router.indexOf('Component: ScheduleServices'));checks++;
  const settings=await readFile('src/pages/SettingsPage.tsx','utf8');
  assert(settings.includes("navigate('/account')")&&settings.includes("navigate('/settings/favorites')"));checks++;
  console.log(JSON.stringify({result:'PASS',checks,actions:favoriteActions.length}));
} finally {await server.close();}
