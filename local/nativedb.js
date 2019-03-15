const http = require('http');
const cheerio = require('cheerio');
const Q = require('q');
const randua = require('random-useragent');

// Native count = 5180

var Website = 'www.dev-c.com';

var Endpoints = {
	PLAYER:    '/nativedb/ns/PLAYER',
	ENTITY:    '/nativedb/ns/ENTITY',
	PED:       '/nativedb/ns/PED',
	VEHICLE:   '/nativedb/ns/VEHICLE',
	OBJECT:    '/nativedb/ns/OBJECT',
	AI:        '/nativedb/ns/AI',
	GAMEPLAY:  '/nativedb/ns/GAMEPLAY',
	AUDIO:     '/nativedb/ns/AUDIO',
	CUTSCENE:  '/nativedb/ns/CUTSCENE',
	INTERIOR:  '/nativedb/ns/INTERIOR',
	CAM:       '/nativedb/ns/CAM',
	WEAPON:    '/nativedb/ns/WEAPON',
	ITEMSET:   '/nativedb/ns/ITEMSET',
	STREAMING: '/nativedb/ns/STREAMING',
	SCRIPT:    '/nativedb/ns/SCRIPT',
	UI:        '/nativedb/ns/UI',
	GRAPHICS:  '/nativedb/ns/GRAPHICS',
	STATS:     '/nativedb/ns/STATS',
	BRAIN:     '/nativedb/ns/BRAIN',
	MOBILE:    '/nativedb/ns/MOBILE',
	APP:       '/nativedb/ns/APP',
	TIME:      '/nativedb/ns/TIME',
	PATHFIND:  '/nativedb/ns/PATHFIND',
	CONTROLS:  '/nativedb/ns/CONTROLS',
	DATAFILE:  '/nativedb/ns/DATAFILE',
	FIRE:      '/nativedb/ns/FIRE',
	DECISIONEVENT: '/nativedb/ns/DECISIONEVENT',
	ZONE:          '/nativedb/ns/ZONE',
	ROPE:          '/nativedb/ns/ROPE',
	WATER:         '/nativedb/ns/WATER',
	WORLDPROBE:    '/nativedb/ns/WORLDPROBE',
	NETWORK:       '/nativedb/ns/NETWORK',
	NETWORKCASH:   '/nativedb/ns/NETWORKCASH',
	DLC1:          '/nativedb/ns/DLC1',
	DLC2:          '/nativedb/ns/DLC2',
	SYSTEM:        '/nativedb/ns/SYSTEM',
	DECORATOR:     '/nativedb/ns/DECORATOR',
	SOCIALCLUB:    '/nativedb/ns/SOCIALCLUB',
	UNK:  '/nativedb/ns/UNK',
	UNK1: '/nativedb/ns/UNK1',
	UNK2: '/nativedb/ns/UNK2',
	UNK3: '/nativedb/ns/UNK3'
};

var FunctionEndpoint = '/nativedb/func/info/';
var SearchEndpoint = '/nativedb/func/find';

var agent = new http.Agent({ keepAlive: true });

function GetRandomUA() {
	return randua.getRandom((ua) => {
		return ua.folder.startsWith('/Browsers');
	});
}

var currentUA = GetRandomUA() + ' (Backing up nativedb (web: calmnap.ml))';

var cookieStorage = [];

function CheckCookies(headers) {
	// Remove expired cookies
	if (cookieStorage.length > 0) {
		cookieStorage.forEach((item, i) => {
			if (item.expires && item.expires >= new Date()) {
				cookieStorage.slice(i, 1);
			}
		});
	}
	
	// Add new cookies if need
	if (headers['set-cookie']) {
		headers['set-cookie'].forEach((item) => {
			var cookie = item.split(';').map((s) => {
				return s.replace(/^\s\s*/, '').replace(/\s\s*$/, ''); // trim whitespaces at start and end
			});

			var storageItem = { data: cookie[0] };

			if (cookie[1] && cookie[1].startsWith('expires=')) {
				var date = cookie[1].slice(8);
				date = Date.parse(date);
				
				if (!isNaN(date)) {
					storageItem["expires"] = new Date(date);
				}
			}

			cookieStorage.push(storageItem);
		});
	}
}

function GetCookies() {
	var result = '';

	cookieStorage.forEach((i) => {
		if (!i.data.startsWith('__'))
			result += i.data + '; ';
	});

	return result.slice(0, result.length - 2);
}

/* PUBLIC STUFF */

function GetNamespace(endpoint) {
	return Q.Promise((resolve, reject, notify) => {
		var options = {
			hostname: Website,
			path: endpoint,
			agent: agent,
			headers: {
				'X-Requested-With': 'XMLHttpRequest',
				'User-Agent': currentUA
			}
		};

		if (cookieStorage.length > 0) {
			options.headers["Cookie"] = GetCookies();
		}

		var request = http.request(options, (response) => {
			CheckCookies(response.headers);

			var jsonText = '';

			response.on('data', (chunk) => {
				jsonText += chunk;
			});

			response.on('end', () => {
				var json = null;

				try {
					json = JSON.parse(jsonText)
				} catch (err) {
					return reject(err + "\nWhen fetching namespace\n" + jsonText);
				}

				var errors = json.errors;
				var content = json.content;

				if (errors) {
					return reject(errors);
				}

				$ = cheerio.load(content);
				var li = $('ul').find('li');
				var output = [];				
				
				// Try/catch here assuming that if there is a content with an error
				// then cheerio will not find ul/li and li.each will throw an exception
				try {
					li.each((i, item) => {
						var fnDef = {
							name: null,
							returnType: null,
							params: {},
							address: null
						};

						var span = $('a:last-child span', item);
						var fnTypes = $('span[class=fntype]', span);
						var fnAddrs = $('span[class=fncomm]', span);
						var fnNameRaw = span.text();

						fnDef.returnType = $(fnTypes[0]).text();
						fnDef.address = fnAddrs.text().substring(3).split(' ');

						var indexOfBrace = fnNameRaw.indexOf('(');
						var params = fnNameRaw.substr(indexOfBrace + 1, fnNameRaw.indexOf(')') - indexOfBrace - 1);

						if (params.length > 0) {
							if (params.indexOf(',') > 0) {
								params = params.split(',');

								for (var j = 0; j < params.length; j++) {
									var p = params[j].trim().split(' ');
									fnDef.params[j] = { type: p[0], name: p[1] };
								}
							} else {
								var p = params.trim().split(' ');
								fnDef.params[0] = { type: p[0], name: p[1] };
							}
						}

						fnDef.name = fnNameRaw.substring(fnDef.returnType.length + 1, indexOfBrace);

						// Can't get pointer sign here because it's not in span
						/*var fnParams = $('span[class=fnparam]', span);
						if (fnTypes.length > 1) {
							for (var j = 0; j < fnParams.length; j++) {
								var p = $(fnParams[j]);
								var t = $(fnTypes[j + 1]);
								fnDef.params[j] = { type: t.text(), name: p.text() };
							}
						}*/

						output.push(fnDef);
					});
				} catch (err) {
					return reject(err);
				}

				resolve(output);
			});
		});

		var socket = null;

		request.on('socket', (sock) => {
			socket = sock;
			sock.setTimeout(10000);
			sock.on('timeout', () => request.abort());
		});

		request.on('error', (err) => reject(err));
		request.end(() => socket.removeAllListeners('timeout'));
	});
}

function GetFunctionInfo(id) {
	return Q.Promise((resolve, reject, notify) => {
		var options = {
			hostname: Website,
			path: FunctionEndpoint + id,
			agent: agent,
			headers: {
				'X-Requested-With': 'XMLHttpRequest',
				'User-Agent': currentUA
			}
		};

		var request = http.request(options, (response) => {			
			CheckCookies(response.headers);
			
			var jsonText = '';

			response.on('data', (chunk) => {
				jsonText += chunk;
			});

			response.on('end', () => {
				var json = null;

				try {
					json = JSON.parse(jsonText);
				} catch (err) {
					return reject(err);
				}

				var errors = json.errors;
				var content = json.content;

				if (errors)	return reject(errors);
				
				try {
					$ = cheerio.load(content);
					var output = {
						namespace: "",
						name: "",
						address: [],
						description: []
					};
					
					var name = $('h2').text().split('::');
					var addr = $('i').text().split(' ');
					var desc = $('p').html().toString().split(/<[\n]*b[\n]*r[\n]*>/ig);

					output.address.push(addr[1]);
					output.address.push(addr[2]);
					output.namespace = name[0];
					output.name = name[1];
					output.description = desc;

					resolve(output);
				} catch (err) {
					reject(err);
				}
			});
		});

		var socket = null;

		request.on('socket', (sock) => {
			socket = sock;
			sock.setTimeout(10000);
			sock.on('timeout', () => request.abort());
		});

		request.on('error', (err) => reject(err));
		request.end(() => socket.removeAllListeners('timeout'));
	});
}

exports.Website   = Website;
exports.Endpoints = Endpoints;
exports.FunctionEndpoint = FunctionEndpoint;
exports.SearchEndpoint   = SearchEndpoint;
exports.GetNamespace     = GetNamespace;
exports.GetFunctionInfo  = GetFunctionInfo;
