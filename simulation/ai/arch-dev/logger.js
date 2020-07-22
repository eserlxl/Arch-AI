// Adaptive Logger to log only the most required data

ARCH.Logger = function () {
	this.log = {};
	this.severity = {};
	this.type = {};
	this.initialValue = {"DEBUG": 100, "INFO": 200, "BUG": 300, "WARNING": 400, "ERROR": 500};
};

ARCH.Logger.prototype.print = function (type, text) {
	if (type === "DEBUG" || type === "INFO" || type === "BUG") {
		log("P" + PlayerID + " " + type + ": " + text);
		print("P" + PlayerID + " " + type + ": " + text);
	} else if (type === "WARNING") {
		warn("P" + PlayerID + " " + text);
	} else if (type === "ERROR") {
		error("P" + PlayerID + " " + text);
	}
};

ARCH.Logger.prototype.push = function (type, section, data, initialValue = false) {

	if (!this.log[section]) {
		this.log[section] = {};
		this.type[section] = {};
		this.severity[section] = {};
	}

	let dataHash = ARCH.hash(data, 20); // Max. fixed debug message length was considered as 20

	if (this.log[section][dataHash]) {
		this.severity[section][dataHash] = ARCH.limit(this.severity[section][dataHash] * 0.95, 1, 1000);
	} else {
		this.type[section][dataHash] = type;
		this.log[section][dataHash] = "[ " + section + " ] " + data;
		this.severity[section][dataHash] = initialValue ? initialValue : this.initialValue[type];
		this.print(type, this.log[section][dataHash]);
	}
};

ARCH.Logger.prototype.update = function () {
	for (let section in this.log) {
		for (let hash in this.log[section]) {
			this.severity[section][hash] *= 1.01;
			if (this.severity[section][hash] >= 750) {
				this.print(this.type[section][hash], this.log[section][hash]);
				this.log[section][hash] = undefined;
				this.severity[section][hash] = undefined;
				this.type[section][hash] = undefined;
			}
		}
	}
};