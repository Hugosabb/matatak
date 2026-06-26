from aiohttp import web
import os

async def service_worker(request):
    response = web.FileResponse(os.path.join("static", "service-worker.js"))
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    return response

async def manifest(request):
    return web.FileResponse(os.path.join("static", "manifest.json"))
