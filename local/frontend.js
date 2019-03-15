const http = require('http');
const url = require('url');

function Router() {
	this._routes = [];
	this._fallback = function(request, response) { };

	this.run = function (request, response) {
		var pathname = url.parse(request.url).pathname;

		var match = this._routes.map(function(route) {
			var routeUrl = route.url;
			var requestUrl = pathname.split('/');

			if ((!route.wildcard && requestUrl.length !== routeUrl.length) ||
				(route.wildcard && requestUrl.length < routeUrl.length))
				return null;

			var args = [];
			var wildcard = null;
			var length = route.wildcard ? requestUrl.length : routeUrl.length;

			for(var i = 0; i < length; i++) {
				if (wildcard !== null) {
					wildcard.push(requestUrl[i]);
				} else {
					if (routeUrl[i].startsWith(':')) {
						if (routeUrl[i].endsWith('+')) {
							wildcard = [];
							wildcard.push(requestUrl[i]);
						} else {
							args.push(requestUrl[i]);
						}
					} else if (routeUrl[i] !== requestUrl[i]) {
						return null;
					}
				}				
			}

			if (wildcard) args.push(wildcard);

			return { route, args };

		}).filter(i => i != null)[0];

		if (match) {
			match.route.callback.apply(null, [request, response].concat(match.args));
		} else {
			this._fallback(request, response);
		}
	}

	this.get = function (url, callback) {
		if (typeof url === 'function') {
			this._fallback = url;
			return;
		}

		var parts = url.split('/');
		var wild = parts[parts.length - 1].startsWith(':') && parts[parts.length - 1].endsWith('+');
		
		this._routes.push({ url: parts, callback, wildcard: wild });
	}
}

function MimeFromPath(path) {
	if (path.length <= 1)
		return 'text/html';

	var parts = path.split('/');
	var filename = parts[parts.length - 1].split('.');
	var type = filename[filename.length - 1];

	switch(type) {
		case 'html': return 'text/html' ;
		case 'js':   return 'application/javascript';
		case 'css':  return 'text/css';
		case 'jpeg': return 'image/jpeg';
		case 'jpg':  return 'image/jpeg';
		case 'gif':  return 'image/gif';
		case 'png':  return 'image/png';
		default:     return 'application/octet-stream';
	}
}

exports.Router = Router;
exports.MimeFromPath = MimeFromPath;
