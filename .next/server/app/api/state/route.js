/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
(() => {
var exports = {};
exports.id = "app/api/state/route";
exports.ids = ["app/api/state/route"];
exports.modules = {

/***/ "(rsc)/./app/api/state/route.ts":
/*!********************************!*\
  !*** ./app/api/state/route.ts ***!
  \********************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   GET: () => (/* binding */ GET),\n/* harmony export */   POST: () => (/* binding */ POST)\n/* harmony export */ });\n/* harmony import */ var next_server__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/server */ \"(rsc)/./node_modules/next/dist/api/server.js\");\n/* harmony import */ var _supabase_supabase_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! @supabase/supabase-js */ \"(rsc)/./node_modules/@supabase/supabase-js/dist/index.mjs\");\n\n\nfunction getAdmin() {\n    const url = (process.env.SUPABASE_URL ?? '').trim();\n    const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '').trim();\n    if (!url || !key) return null;\n    return (0,_supabase_supabase_js__WEBPACK_IMPORTED_MODULE_1__.createClient)(url, key);\n}\nasync function GET() {\n    const sb = getAdmin();\n    if (!sb) return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n        error: 'No Supabase config'\n    }, {\n        status: 500\n    });\n    try {\n        const [stateRes, blobsRes] = await Promise.all([\n            sb.from('app_state_store').select('payload').eq('id', 'default').single(),\n            sb.from('app_blob_store').select('id,value')\n        ]);\n        const payload = stateRes.data?.payload ?? [];\n        const blobs = {};\n        for (const row of blobsRes.data ?? [])blobs[row.id] = row.value;\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            payload,\n            blobs\n        });\n    } catch (error) {\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            error: String(error)\n        }, {\n            status: 500\n        });\n    }\n}\nasync function POST(request) {\n    const sb = getAdmin();\n    if (!sb) return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n        error: 'No Supabase config'\n    }, {\n        status: 500\n    });\n    try {\n        const { payload, blobs } = await request.json();\n        const now = new Date().toISOString();\n        await sb.from('app_state_store').upsert({\n            id: 'default',\n            payload,\n            updated_at: now\n        });\n        if (blobs && Object.keys(blobs).length > 0) {\n            const rows = Object.entries(blobs).map(([id, value])=>({\n                    id,\n                    value,\n                    updated_at: now\n                }));\n            await sb.from('app_blob_store').upsert(rows);\n        }\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            ok: true\n        });\n    } catch (error) {\n        return next_server__WEBPACK_IMPORTED_MODULE_0__.NextResponse.json({\n            error: String(error)\n        }, {\n            status: 500\n        });\n    }\n}\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9hcHAvYXBpL3N0YXRlL3JvdXRlLnRzIiwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBdUQ7QUFDSDtBQUVwRCxTQUFTRTtJQUNQLE1BQU1DLE1BQU0sQ0FBQ0MsUUFBUUMsR0FBRyxDQUFDQyxZQUFZLElBQUksRUFBQyxFQUFHQyxJQUFJO0lBQ2pELE1BQU1DLE1BQU0sQ0FBQ0osUUFBUUMsR0FBRyxDQUFDSSx5QkFBeUIsSUFBSUwsUUFBUUMsR0FBRyxDQUFDSyxpQkFBaUIsSUFBSSxFQUFDLEVBQUdILElBQUk7SUFDL0YsSUFBSSxDQUFDSixPQUFPLENBQUNLLEtBQUssT0FBTztJQUN6QixPQUFPUCxtRUFBWUEsQ0FBQ0UsS0FBS0s7QUFDM0I7QUFFTyxlQUFlRztJQUNwQixNQUFNQyxLQUFLVjtJQUNYLElBQUksQ0FBQ1UsSUFBSSxPQUFPWixxREFBWUEsQ0FBQ2EsSUFBSSxDQUFDO1FBQUVDLE9BQU87SUFBcUIsR0FBRztRQUFFQyxRQUFRO0lBQUk7SUFDakYsSUFBSTtRQUNGLE1BQU0sQ0FBQ0MsVUFBVUMsU0FBUyxHQUFHLE1BQU1DLFFBQVFDLEdBQUcsQ0FBQztZQUM3Q1AsR0FBR1EsSUFBSSxDQUFDLG1CQUFtQkMsTUFBTSxDQUFDLFdBQVdDLEVBQUUsQ0FBQyxNQUFNLFdBQVdDLE1BQU07WUFDdkVYLEdBQUdRLElBQUksQ0FBQyxrQkFBa0JDLE1BQU0sQ0FBQztTQUNsQztRQUNELE1BQU1HLFVBQVVSLFNBQVNTLElBQUksRUFBRUQsV0FBVyxFQUFFO1FBQzVDLE1BQU1FLFFBQWdDLENBQUM7UUFDdkMsS0FBSyxNQUFNQyxPQUFPVixTQUFTUSxJQUFJLElBQUksRUFBRSxDQUFFQyxLQUFLLENBQUNDLElBQUlDLEVBQUUsQ0FBQyxHQUFHRCxJQUFJRSxLQUFLO1FBQ2hFLE9BQU83QixxREFBWUEsQ0FBQ2EsSUFBSSxDQUFDO1lBQUVXO1lBQVNFO1FBQU07SUFDNUMsRUFBRSxPQUFPWixPQUFPO1FBQ2QsT0FBT2QscURBQVlBLENBQUNhLElBQUksQ0FBQztZQUFFQyxPQUFPZ0IsT0FBT2hCO1FBQU8sR0FBRztZQUFFQyxRQUFRO1FBQUk7SUFDbkU7QUFDRjtBQUVPLGVBQWVnQixLQUFLQyxPQUFvQjtJQUM3QyxNQUFNcEIsS0FBS1Y7SUFDWCxJQUFJLENBQUNVLElBQUksT0FBT1oscURBQVlBLENBQUNhLElBQUksQ0FBQztRQUFFQyxPQUFPO0lBQXFCLEdBQUc7UUFBRUMsUUFBUTtJQUFJO0lBQ2pGLElBQUk7UUFDRixNQUFNLEVBQUVTLE9BQU8sRUFBRUUsS0FBSyxFQUFFLEdBQUcsTUFBTU0sUUFBUW5CLElBQUk7UUFDN0MsTUFBTW9CLE1BQU0sSUFBSUMsT0FBT0MsV0FBVztRQUNsQyxNQUFNdkIsR0FBR1EsSUFBSSxDQUFDLG1CQUFtQmdCLE1BQU0sQ0FBQztZQUFFUixJQUFJO1lBQVdKO1lBQVNhLFlBQVlKO1FBQUk7UUFDbEYsSUFBSVAsU0FBU1ksT0FBT0MsSUFBSSxDQUFDYixPQUFPYyxNQUFNLEdBQUcsR0FBRztZQUMxQyxNQUFNQyxPQUFPSCxPQUFPSSxPQUFPLENBQUNoQixPQUFPaUIsR0FBRyxDQUFDLENBQUMsQ0FBQ2YsSUFBSUMsTUFBTSxHQUFNO29CQUFFRDtvQkFBSUM7b0JBQU9RLFlBQVlKO2dCQUFJO1lBQ3RGLE1BQU1yQixHQUFHUSxJQUFJLENBQUMsa0JBQWtCZ0IsTUFBTSxDQUFDSztRQUN6QztRQUNBLE9BQU96QyxxREFBWUEsQ0FBQ2EsSUFBSSxDQUFDO1lBQUUrQixJQUFJO1FBQUs7SUFDdEMsRUFBRSxPQUFPOUIsT0FBTztRQUNkLE9BQU9kLHFEQUFZQSxDQUFDYSxJQUFJLENBQUM7WUFBRUMsT0FBT2dCLE9BQU9oQjtRQUFPLEdBQUc7WUFBRUMsUUFBUTtRQUFJO0lBQ25FO0FBQ0YiLCJzb3VyY2VzIjpbIkM6XFxVc2Vyc1xcVGhtYXNcXERlc2t0b3BcXEFJLUNoYW50aWVyLUNEXFxhcHBcXGFwaVxcc3RhdGVcXHJvdXRlLnRzIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IE5leHRSZXF1ZXN0LCBOZXh0UmVzcG9uc2UgfSBmcm9tICduZXh0L3NlcnZlcidcbmltcG9ydCB7IGNyZWF0ZUNsaWVudCB9IGZyb20gJ0BzdXBhYmFzZS9zdXBhYmFzZS1qcydcblxuZnVuY3Rpb24gZ2V0QWRtaW4oKSB7XG4gIGNvbnN0IHVybCA9IChwcm9jZXNzLmVudi5TVVBBQkFTRV9VUkwgPz8gJycpLnRyaW0oKVxuICBjb25zdCBrZXkgPSAocHJvY2Vzcy5lbnYuU1VQQUJBU0VfU0VSVklDRV9ST0xFX0tFWSA/PyBwcm9jZXNzLmVudi5TVVBBQkFTRV9BTk9OX0tFWSA/PyAnJykudHJpbSgpXG4gIGlmICghdXJsIHx8ICFrZXkpIHJldHVybiBudWxsXG4gIHJldHVybiBjcmVhdGVDbGllbnQodXJsLCBrZXkpXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBHRVQoKSB7XG4gIGNvbnN0IHNiID0gZ2V0QWRtaW4oKVxuICBpZiAoIXNiKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogJ05vIFN1cGFiYXNlIGNvbmZpZycgfSwgeyBzdGF0dXM6IDUwMCB9KVxuICB0cnkge1xuICAgIGNvbnN0IFtzdGF0ZVJlcywgYmxvYnNSZXNdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgc2IuZnJvbSgnYXBwX3N0YXRlX3N0b3JlJykuc2VsZWN0KCdwYXlsb2FkJykuZXEoJ2lkJywgJ2RlZmF1bHQnKS5zaW5nbGUoKSxcbiAgICAgIHNiLmZyb20oJ2FwcF9ibG9iX3N0b3JlJykuc2VsZWN0KCdpZCx2YWx1ZScpLFxuICAgIF0pXG4gICAgY29uc3QgcGF5bG9hZCA9IHN0YXRlUmVzLmRhdGE/LnBheWxvYWQgPz8gW11cbiAgICBjb25zdCBibG9iczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG4gICAgZm9yIChjb25zdCByb3cgb2YgYmxvYnNSZXMuZGF0YSA/PyBbXSkgYmxvYnNbcm93LmlkXSA9IHJvdy52YWx1ZVxuICAgIHJldHVybiBOZXh0UmVzcG9uc2UuanNvbih7IHBheWxvYWQsIGJsb2JzIH0pXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgZXJyb3I6IFN0cmluZyhlcnJvcikgfSwgeyBzdGF0dXM6IDUwMCB9KVxuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBQT1NUKHJlcXVlc3Q6IE5leHRSZXF1ZXN0KSB7XG4gIGNvbnN0IHNiID0gZ2V0QWRtaW4oKVxuICBpZiAoIXNiKSByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogJ05vIFN1cGFiYXNlIGNvbmZpZycgfSwgeyBzdGF0dXM6IDUwMCB9KVxuICB0cnkge1xuICAgIGNvbnN0IHsgcGF5bG9hZCwgYmxvYnMgfSA9IGF3YWl0IHJlcXVlc3QuanNvbigpXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgYXdhaXQgc2IuZnJvbSgnYXBwX3N0YXRlX3N0b3JlJykudXBzZXJ0KHsgaWQ6ICdkZWZhdWx0JywgcGF5bG9hZCwgdXBkYXRlZF9hdDogbm93IH0pXG4gICAgaWYgKGJsb2JzICYmIE9iamVjdC5rZXlzKGJsb2JzKS5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCByb3dzID0gT2JqZWN0LmVudHJpZXMoYmxvYnMpLm1hcCgoW2lkLCB2YWx1ZV0pID0+ICh7IGlkLCB2YWx1ZSwgdXBkYXRlZF9hdDogbm93IH0pKVxuICAgICAgYXdhaXQgc2IuZnJvbSgnYXBwX2Jsb2Jfc3RvcmUnKS51cHNlcnQocm93cylcbiAgICB9XG4gICAgcmV0dXJuIE5leHRSZXNwb25zZS5qc29uKHsgb2s6IHRydWUgfSlcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4gTmV4dFJlc3BvbnNlLmpzb24oeyBlcnJvcjogU3RyaW5nKGVycm9yKSB9LCB7IHN0YXR1czogNTAwIH0pXG4gIH1cbn1cbiJdLCJuYW1lcyI6WyJOZXh0UmVzcG9uc2UiLCJjcmVhdGVDbGllbnQiLCJnZXRBZG1pbiIsInVybCIsInByb2Nlc3MiLCJlbnYiLCJTVVBBQkFTRV9VUkwiLCJ0cmltIiwia2V5IiwiU1VQQUJBU0VfU0VSVklDRV9ST0xFX0tFWSIsIlNVUEFCQVNFX0FOT05fS0VZIiwiR0VUIiwic2IiLCJqc29uIiwiZXJyb3IiLCJzdGF0dXMiLCJzdGF0ZVJlcyIsImJsb2JzUmVzIiwiUHJvbWlzZSIsImFsbCIsImZyb20iLCJzZWxlY3QiLCJlcSIsInNpbmdsZSIsInBheWxvYWQiLCJkYXRhIiwiYmxvYnMiLCJyb3ciLCJpZCIsInZhbHVlIiwiU3RyaW5nIiwiUE9TVCIsInJlcXVlc3QiLCJub3ciLCJEYXRlIiwidG9JU09TdHJpbmciLCJ1cHNlcnQiLCJ1cGRhdGVkX2F0IiwiT2JqZWN0Iiwia2V5cyIsImxlbmd0aCIsInJvd3MiLCJlbnRyaWVzIiwibWFwIiwib2siXSwiaWdub3JlTGlzdCI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(rsc)/./app/api/state/route.ts\n");

/***/ }),

/***/ "(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Fapi%2Fstate%2Froute&page=%2Fapi%2Fstate%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Fstate%2Froute.ts&appDir=C%3A%5CUsers%5CThmas%5CDesktop%5CAI-Chantier-CD%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=C%3A%5CUsers%5CThmas%5CDesktop%5CAI-Chantier-CD&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!":
/*!***********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Fapi%2Fstate%2Froute&page=%2Fapi%2Fstate%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Fstate%2Froute.ts&appDir=C%3A%5CUsers%5CThmas%5CDesktop%5CAI-Chantier-CD%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=C%3A%5CUsers%5CThmas%5CDesktop%5CAI-Chantier-CD&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D! ***!
  \***********************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

"use strict";
eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   patchFetch: () => (/* binding */ patchFetch),\n/* harmony export */   routeModule: () => (/* binding */ routeModule),\n/* harmony export */   serverHooks: () => (/* binding */ serverHooks),\n/* harmony export */   workAsyncStorage: () => (/* binding */ workAsyncStorage),\n/* harmony export */   workUnitAsyncStorage: () => (/* binding */ workUnitAsyncStorage)\n/* harmony export */ });\n/* harmony import */ var next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! next/dist/server/route-modules/app-route/module.compiled */ \"(rsc)/./node_modules/next/dist/server/route-modules/app-route/module.compiled.js\");\n/* harmony import */ var next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var next_dist_server_route_kind__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! next/dist/server/route-kind */ \"(rsc)/./node_modules/next/dist/server/route-kind.js\");\n/* harmony import */ var next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! next/dist/server/lib/patch-fetch */ \"(rsc)/./node_modules/next/dist/server/lib/patch-fetch.js\");\n/* harmony import */ var next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__);\n/* harmony import */ var C_Users_Thmas_Desktop_AI_Chantier_CD_app_api_state_route_ts__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./app/api/state/route.ts */ \"(rsc)/./app/api/state/route.ts\");\n\n\n\n\n// We inject the nextConfigOutput here so that we can use them in the route\n// module.\nconst nextConfigOutput = \"\"\nconst routeModule = new next_dist_server_route_modules_app_route_module_compiled__WEBPACK_IMPORTED_MODULE_0__.AppRouteRouteModule({\n    definition: {\n        kind: next_dist_server_route_kind__WEBPACK_IMPORTED_MODULE_1__.RouteKind.APP_ROUTE,\n        page: \"/api/state/route\",\n        pathname: \"/api/state\",\n        filename: \"route\",\n        bundlePath: \"app/api/state/route\"\n    },\n    resolvedPagePath: \"C:\\\\Users\\\\Thmas\\\\Desktop\\\\AI-Chantier-CD\\\\app\\\\api\\\\state\\\\route.ts\",\n    nextConfigOutput,\n    userland: C_Users_Thmas_Desktop_AI_Chantier_CD_app_api_state_route_ts__WEBPACK_IMPORTED_MODULE_3__\n});\n// Pull out the exports that we need to expose from the module. This should\n// be eliminated when we've moved the other routes to the new format. These\n// are used to hook into the route.\nconst { workAsyncStorage, workUnitAsyncStorage, serverHooks } = routeModule;\nfunction patchFetch() {\n    return (0,next_dist_server_lib_patch_fetch__WEBPACK_IMPORTED_MODULE_2__.patchFetch)({\n        workAsyncStorage,\n        workUnitAsyncStorage\n    });\n}\n\n\n//# sourceMappingURL=app-route.js.map//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHJzYykvLi9ub2RlX21vZHVsZXMvbmV4dC9kaXN0L2J1aWxkL3dlYnBhY2svbG9hZGVycy9uZXh0LWFwcC1sb2FkZXIvaW5kZXguanM/bmFtZT1hcHAlMkZhcGklMkZzdGF0ZSUyRnJvdXRlJnBhZ2U9JTJGYXBpJTJGc3RhdGUlMkZyb3V0ZSZhcHBQYXRocz0mcGFnZVBhdGg9cHJpdmF0ZS1uZXh0LWFwcC1kaXIlMkZhcGklMkZzdGF0ZSUyRnJvdXRlLnRzJmFwcERpcj1DJTNBJTVDVXNlcnMlNUNUaG1hcyU1Q0Rlc2t0b3AlNUNBSS1DaGFudGllci1DRCU1Q2FwcCZwYWdlRXh0ZW5zaW9ucz10c3gmcGFnZUV4dGVuc2lvbnM9dHMmcGFnZUV4dGVuc2lvbnM9anN4JnBhZ2VFeHRlbnNpb25zPWpzJnJvb3REaXI9QyUzQSU1Q1VzZXJzJTVDVGhtYXMlNUNEZXNrdG9wJTVDQUktQ2hhbnRpZXItQ0QmaXNEZXY9dHJ1ZSZ0c2NvbmZpZ1BhdGg9dHNjb25maWcuanNvbiZiYXNlUGF0aD0mYXNzZXRQcmVmaXg9Jm5leHRDb25maWdPdXRwdXQ9JnByZWZlcnJlZFJlZ2lvbj0mbWlkZGxld2FyZUNvbmZpZz1lMzAlM0QhIiwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7O0FBQStGO0FBQ3ZDO0FBQ3FCO0FBQ29CO0FBQ2pHO0FBQ0E7QUFDQTtBQUNBLHdCQUF3Qix5R0FBbUI7QUFDM0M7QUFDQSxjQUFjLGtFQUFTO0FBQ3ZCO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQ0E7QUFDQSxZQUFZO0FBQ1osQ0FBQztBQUNEO0FBQ0E7QUFDQTtBQUNBLFFBQVEsc0RBQXNEO0FBQzlEO0FBQ0EsV0FBVyw0RUFBVztBQUN0QjtBQUNBO0FBQ0EsS0FBSztBQUNMO0FBQzBGOztBQUUxRiIsInNvdXJjZXMiOlsiIl0sInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IEFwcFJvdXRlUm91dGVNb2R1bGUgfSBmcm9tIFwibmV4dC9kaXN0L3NlcnZlci9yb3V0ZS1tb2R1bGVzL2FwcC1yb3V0ZS9tb2R1bGUuY29tcGlsZWRcIjtcbmltcG9ydCB7IFJvdXRlS2luZCB9IGZyb20gXCJuZXh0L2Rpc3Qvc2VydmVyL3JvdXRlLWtpbmRcIjtcbmltcG9ydCB7IHBhdGNoRmV0Y2ggYXMgX3BhdGNoRmV0Y2ggfSBmcm9tIFwibmV4dC9kaXN0L3NlcnZlci9saWIvcGF0Y2gtZmV0Y2hcIjtcbmltcG9ydCAqIGFzIHVzZXJsYW5kIGZyb20gXCJDOlxcXFxVc2Vyc1xcXFxUaG1hc1xcXFxEZXNrdG9wXFxcXEFJLUNoYW50aWVyLUNEXFxcXGFwcFxcXFxhcGlcXFxcc3RhdGVcXFxccm91dGUudHNcIjtcbi8vIFdlIGluamVjdCB0aGUgbmV4dENvbmZpZ091dHB1dCBoZXJlIHNvIHRoYXQgd2UgY2FuIHVzZSB0aGVtIGluIHRoZSByb3V0ZVxuLy8gbW9kdWxlLlxuY29uc3QgbmV4dENvbmZpZ091dHB1dCA9IFwiXCJcbmNvbnN0IHJvdXRlTW9kdWxlID0gbmV3IEFwcFJvdXRlUm91dGVNb2R1bGUoe1xuICAgIGRlZmluaXRpb246IHtcbiAgICAgICAga2luZDogUm91dGVLaW5kLkFQUF9ST1VURSxcbiAgICAgICAgcGFnZTogXCIvYXBpL3N0YXRlL3JvdXRlXCIsXG4gICAgICAgIHBhdGhuYW1lOiBcIi9hcGkvc3RhdGVcIixcbiAgICAgICAgZmlsZW5hbWU6IFwicm91dGVcIixcbiAgICAgICAgYnVuZGxlUGF0aDogXCJhcHAvYXBpL3N0YXRlL3JvdXRlXCJcbiAgICB9LFxuICAgIHJlc29sdmVkUGFnZVBhdGg6IFwiQzpcXFxcVXNlcnNcXFxcVGhtYXNcXFxcRGVza3RvcFxcXFxBSS1DaGFudGllci1DRFxcXFxhcHBcXFxcYXBpXFxcXHN0YXRlXFxcXHJvdXRlLnRzXCIsXG4gICAgbmV4dENvbmZpZ091dHB1dCxcbiAgICB1c2VybGFuZFxufSk7XG4vLyBQdWxsIG91dCB0aGUgZXhwb3J0cyB0aGF0IHdlIG5lZWQgdG8gZXhwb3NlIGZyb20gdGhlIG1vZHVsZS4gVGhpcyBzaG91bGRcbi8vIGJlIGVsaW1pbmF0ZWQgd2hlbiB3ZSd2ZSBtb3ZlZCB0aGUgb3RoZXIgcm91dGVzIHRvIHRoZSBuZXcgZm9ybWF0LiBUaGVzZVxuLy8gYXJlIHVzZWQgdG8gaG9vayBpbnRvIHRoZSByb3V0ZS5cbmNvbnN0IHsgd29ya0FzeW5jU3RvcmFnZSwgd29ya1VuaXRBc3luY1N0b3JhZ2UsIHNlcnZlckhvb2tzIH0gPSByb3V0ZU1vZHVsZTtcbmZ1bmN0aW9uIHBhdGNoRmV0Y2goKSB7XG4gICAgcmV0dXJuIF9wYXRjaEZldGNoKHtcbiAgICAgICAgd29ya0FzeW5jU3RvcmFnZSxcbiAgICAgICAgd29ya1VuaXRBc3luY1N0b3JhZ2VcbiAgICB9KTtcbn1cbmV4cG9ydCB7IHJvdXRlTW9kdWxlLCB3b3JrQXN5bmNTdG9yYWdlLCB3b3JrVW5pdEFzeW5jU3RvcmFnZSwgc2VydmVySG9va3MsIHBhdGNoRmV0Y2gsICB9O1xuXG4vLyMgc291cmNlTWFwcGluZ1VSTD1hcHAtcm91dGUuanMubWFwIl0sIm5hbWVzIjpbXSwiaWdub3JlTGlzdCI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Fapi%2Fstate%2Froute&page=%2Fapi%2Fstate%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Fstate%2Froute.ts&appDir=C%3A%5CUsers%5CThmas%5CDesktop%5CAI-Chantier-CD%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=C%3A%5CUsers%5CThmas%5CDesktop%5CAI-Chantier-CD&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!\n");

/***/ }),

/***/ "(rsc)/./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true!":
/*!******************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true! ***!
  \******************************************************************************************************/
/***/ (() => {



/***/ }),

/***/ "(ssr)/./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true!":
/*!******************************************************************************************************!*\
  !*** ./node_modules/next/dist/build/webpack/loaders/next-flight-client-entry-loader.js?server=true! ***!
  \******************************************************************************************************/
/***/ (() => {



/***/ }),

/***/ "../app-render/after-task-async-storage.external":
/*!***********************************************************************************!*\
  !*** external "next/dist/server/app-render/after-task-async-storage.external.js" ***!
  \***********************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/server/app-render/after-task-async-storage.external.js");

/***/ }),

/***/ "../app-render/work-async-storage.external":
/*!*****************************************************************************!*\
  !*** external "next/dist/server/app-render/work-async-storage.external.js" ***!
  \*****************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/server/app-render/work-async-storage.external.js");

/***/ }),

/***/ "./work-unit-async-storage.external":
/*!**********************************************************************************!*\
  !*** external "next/dist/server/app-render/work-unit-async-storage.external.js" ***!
  \**********************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/server/app-render/work-unit-async-storage.external.js");

/***/ }),

/***/ "next/dist/compiled/next-server/app-page.runtime.dev.js":
/*!*************************************************************************!*\
  !*** external "next/dist/compiled/next-server/app-page.runtime.dev.js" ***!
  \*************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/compiled/next-server/app-page.runtime.dev.js");

/***/ }),

/***/ "next/dist/compiled/next-server/app-route.runtime.dev.js":
/*!**************************************************************************!*\
  !*** external "next/dist/compiled/next-server/app-route.runtime.dev.js" ***!
  \**************************************************************************/
/***/ ((module) => {

"use strict";
module.exports = require("next/dist/compiled/next-server/app-route.runtime.dev.js");

/***/ })

};
;

// load runtime
var __webpack_require__ = require("../../../webpack-runtime.js");
__webpack_require__.C(exports);
var __webpack_exec__ = (moduleId) => (__webpack_require__(__webpack_require__.s = moduleId))
var __webpack_exports__ = __webpack_require__.X(0, ["vendor-chunks/next","vendor-chunks/@supabase","vendor-chunks/tslib","vendor-chunks/iceberg-js"], () => (__webpack_exec__("(rsc)/./node_modules/next/dist/build/webpack/loaders/next-app-loader/index.js?name=app%2Fapi%2Fstate%2Froute&page=%2Fapi%2Fstate%2Froute&appPaths=&pagePath=private-next-app-dir%2Fapi%2Fstate%2Froute.ts&appDir=C%3A%5CUsers%5CThmas%5CDesktop%5CAI-Chantier-CD%5Capp&pageExtensions=tsx&pageExtensions=ts&pageExtensions=jsx&pageExtensions=js&rootDir=C%3A%5CUsers%5CThmas%5CDesktop%5CAI-Chantier-CD&isDev=true&tsconfigPath=tsconfig.json&basePath=&assetPrefix=&nextConfigOutput=&preferredRegion=&middlewareConfig=e30%3D!")));
module.exports = __webpack_exports__;

})();