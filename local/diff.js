/*
	This is all synchronous functions
*/

// We take latest backup and compare it with currently fetched
function GetDiff(a, b) {
	if (!a || !b)
		return null;
	
	var output = {};

	var dnt = getNameAndTypeDiff(a, b);
	var dfp = getFunctionParametersDiff(a, b);
	var dds = getDescriptionDiff(a, b);

	Object.assign(output, dnt, dfp, dds);

	if (Object.keys(output).length === 0)
		return null;

	return output;
}

function getNameAndTypeDiff(a, b) {
	var output = null;

	if (a.name !== b.name) {
		if (output)
			output["name"] = b.name;
		else
			output = { name: b.name };
	}
	
	if (a.returnType !== b.returnType) {
		if (output)
			output["returnType"] = b.returnType;
		else
			output = { returnType: b.returnType };
	}

	return output;
}

function getFunctionParametersDiff(a, b) {	
	var length = Object.keys(a.params).length;
	var output = null;

	if (length > Object.keys(b.params).length)
		length = Object.keys(b.params).length;

	for (var i = 0; i < length; i++) {
		var param = getFunctionParamDiff(a.params[i], b.params[i]);

		if (param) {
			if (!output)
				output = { params: {} };

			output.params[i] = param;
		}
	}

	return output;
}

function getFunctionParamDiff(a, b) {
	var output = {};

	if (a.type !== b.type) {
		output["type"] = b.type;
	}

	if (a.name !== b.name) {
		output["name"] = b.name;
	}

	if (Object.keys(output).length == 0)
		return null;

	return output;
}

function getDescriptionDiff(a, b) {	
	var adesc = a.description.add;
	var bdesc = b.description.add;
	var akeys = Object.keys(adesc);
	var bkeys = Object.keys(bdesc);

	var equall = [];
	var newll = [];
	var changedl = [];
	var removedl = [];

	// Determite equal lines
	for (var i = 0; i < akeys.length; i++) {
		if (adesc[i].localeCompare(bdesc[i]) === 0 && i < bkeys.length)
			equall.push(akeys[i]);
	}

	// Check if there is new lines or changed lines
	for (var i = 0; i < bkeys.length; i++) {
		if (!isInArray(bkeys[i], equall)) {
			if (isInArray(bkeys[i], akeys)) {
				changedl.push(bkeys[i]);
			} else {
				newll.push(bkeys[i]);
			}
		}
	}

	// Check for removed lines
	if (akeys.length > bkeys.length) {
		for (var i = 0; i < akeys.length; i++) {
			var key = akeys[i];
			if (!isInArray(key, equall) && !isInArray(key, newll) && !isInArray(key, changedl)) {
				removedl.push(key);
			}
		}
	}

	var output = { description: {} };

	if (newll.length > 0) {
		output.description["add"] = {};

		newll.forEach((i) => {
			output.description.add[i] = bdesc[i];
		});
	}

	if (changedl.length > 0) {
		output.description["change"] = {};

		changedl.forEach((i) => {
			output.description.change[i] = bdesc[i];
		});
	}

	if (removedl.length > 0) {
		output.description["rem"] = {};

		removedl.forEach((i) => {
			output.description.rem[i] = adesc[i];
		});
	}

	if (Object.keys(output.description).length == 0)
		return null;

	return output;
}

function isInArray(value, array) {
	return array.indexOf(value) > -1;
}

// When initializing database we take first backup
// then processes it with next backup and so on
// So in the end we get latest backup

function MergeDiff(a, b) {
	if (!b) return a;
	
	a = mergeNameAndType(a, b);
	a = mergeParams(a, b);
	a = mergeDescription(a, b);

	return a;
}

function mergeNameAndType(a, b) {	
	if (b.name)
		a.name = b.name;
	
	if (b.returnType)
		a.returnType = b.returnType;

	return a;
}

function mergeParams(a, b) {	
	if (b.params) {
		var keys = Object.keys(b.params);

		for (var i = 0; i < keys.length; i++) {
			var index = keys[i];

			if ("name" in b.params[index])
				a.params[index].name = b.params[index].name;

			if ("type" in b.params[index])
				a.params[index].type = b.params[index].type;
		}
	}

	return a;
}

function mergeDescription(a, b) {
	var adesc = a.description;
	var bdesc = b.description;

	if (!bdesc)
		return a;

	if (bdesc.rem) {
		var keys = Object.keys(bdesc.rem);

		// Prevent removing all content
		if (keys.length !== Object.keys(adesc.add).length)
			for (var i = 0; i < keys.length; i++) {
				delete adesc.add[keys[i]];
			}
	}

	if (bdesc.add) {
		var keys = Object.keys(bdesc.add);

		for (var i = 0; i < keys.length; i++) {
			adesc.add[keys[i]] = bdesc.add[keys[i]];
		}
	}

	if (bdesc.change) {
		var keys = Object.keys(bdesc.change);

		for (var i = 0; i < keys.length; i++) {
			adesc.add[keys[i]] = bdesc.change[keys[i]];
		}
	}

	return a;
}

exports.GetDiff = GetDiff;
exports.MergeDiff = MergeDiff;
