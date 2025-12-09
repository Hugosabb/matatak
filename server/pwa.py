from aiohttp import web
import os

async def service_worker(request):
    return web.FileResponse(os.path.join("static", "service-worker.js"))

async def manifest(request):
    return web.FileResponse(os.path.join("static", "manifest.json"))
