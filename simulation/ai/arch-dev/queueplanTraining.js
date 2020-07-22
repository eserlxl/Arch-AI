/**
 * @return {boolean}
 */
ARCH.TrainingPlan = function (gameState, type, metadata, number = 1, maxMerge = 5) {
	if (!ARCH.QueuePlan.call(this, gameState, type, metadata)) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "TrainingPlan", "Training plan " + type + " was cancelled.");
/// DEBUG
		return false;
	}

	// Refine the estimated cost and add pop cost
	let trainers = this.getBestTrainers(gameState);
	let trainer = trainers ? trainers[0] : undefined;
	this.cost = new API3.Resources(this.template.cost(trainer), +this.template._template.Cost.Population);

	this.category = "unit";
	this.number = number;
	this.maxMerge = maxMerge;
	this.type = type;

	return true;
};

ARCH.TrainingPlan.prototype = Object.create(ARCH.QueuePlan.prototype);

ARCH.TrainingPlan.prototype.canStart = function (gameState) {
	this.trainers = this.getBestTrainers(gameState);
	if (!this.trainers) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "TrainingPlan", "Couldn't find an optimum training facility for " + this.type);
/// DEBUG
		return false;
	}

	this.cost = new API3.Resources(this.template.cost(this.trainers[0]), +this.template._template.Cost.Population);
	return true;
};

ARCH.TrainingPlan.prototype.getBestTrainers = function (gameState) {
	if (this.metadata && this.metadata.trainer) {
		let trainer = gameState.getEntityById(this.metadata.trainer);
		if (trainer)
			return [trainer];
	}

	let allTrainers = gameState.findTrainers(this.type);

	if (this.metadata && this.metadata.sea)
		allTrainers = allTrainers.filter(API3.Filters.byMetadata(PlayerID, "sea", this.metadata.sea));
	if (this.metadata && this.metadata.base)
		allTrainers = allTrainers.filter(API3.Filters.byMetadata(PlayerID, "base", this.metadata.base));
	if (!allTrainers || !allTrainers.hasEntities()) {
/// DEBUG
		gameState.ai.logger.push("DEBUG", "TrainingPlan", "Couldn't find an available training facility for " + this.type);
/// DEBUG
		return undefined;
	}


	// Keep only trainers with the smallest cost
	let costMin = Math.min();
	let trainers;
	for (let ent of allTrainers.values()) {
		let cost = this.template.costSum(ent);
		if (cost === costMin)
			trainers.push(ent);
		else if (cost < costMin) {
			costMin = cost;
			trainers = [ent];
		}
	}
	return trainers;
};

ARCH.TrainingPlan.prototype.start = function (gameState) {
	if (this.metadata && this.metadata.trainer) {
		let metadata = {};
		for (let key in this.metadata)
			if (key !== "trainer")
				metadata[key] = this.metadata[key];
		this.metadata = metadata;
	}

	if (this.trainers.length > 1) {
		let wantedIndex;
		if (this.metadata && this.metadata.index)
			wantedIndex = this.metadata.index;
		let workerUnit = this.metadata;// && this.metadata.role && this.metadata.role === "worker";
		let supportUnit = this.template.hasClass("Support");
		this.trainers.sort(function (a, b) {
			// Prefer training buildings with short queues
			let aa = a.trainingQueueTime();
			let bb = b.trainingQueueTime();
			// Give priority to support units in the cc
			if (a.hasClass("Civic") && !supportUnit)
				aa += 10;
			if (b.hasClass("Civic") && !supportUnit)
				bb += 10;
			// And support units should not be too near to dangerous place
			if (supportUnit) {
				if (gameState.ai.HQ.isNearInvadingArmy(a.position()))
					aa += 50;
				if (gameState.ai.HQ.isNearInvadingArmy(b.position()))
					bb += 50;
			}
			// Give also priority to buildings with the right accessibility
			let aBase = a.getMetadata(PlayerID, "base");
			let bBase = b.getMetadata(PlayerID, "base");
			if (wantedIndex) {
				if (!aBase || gameState.ai.HQ.getBaseByID(aBase).accessIndex !== wantedIndex)
					aa += 30;
				if (!bBase || gameState.ai.HQ.getBaseByID(bBase).accessIndex !== wantedIndex)
					bb += 30;
			}
			// Then, if workers, small preference for bases with less workers
			if (workerUnit && aBase && bBase && aBase !== bBase) {
				let apop = gameState.ai.HQ.getBaseByID(aBase).workers.length;
				let bpop = gameState.ai.HQ.getBaseByID(bBase).workers.length;
				if (apop > bpop)
					aa++;
				else if (bpop > apop)
					bb++;
			}
			return aa - bb;
		});
	}

	if (this.metadata && this.metadata.base !== undefined && this.metadata.base === 0)
		this.metadata.base = this.trainers[0].getMetadata(PlayerID, "base");
	this.trainers[0].train(gameState.getPlayerCiv(), this.type, this.number, this.metadata, this.promotedTypes(gameState));

	this.onStart(gameState);
};

ARCH.TrainingPlan.prototype.addItem = function (amount = 1) {
	this.number += amount;
};

/** Find the promoted types corresponding to this.type */
ARCH.TrainingPlan.prototype.promotedTypes = function (gameState) {
	let types = [];
	let promotion = this.template.promotion();
	let previous;
	let template;
	while (promotion) {
		types.push(promotion);
		previous = promotion;
		template = gameState.getTemplate(promotion);
		if (!template) {
/// DEBUG
			gameState.ai.logger.push("WARNING", "TrainingPlan", "Promotion template " + promotion + " is not found!");
/// DEBUG
			promotion = undefined;
			break;
		}
		promotion = template.promotion();
		if (previous === promotion) {
/// DEBUG
			gameState.ai.logger.push("WARNING", "TrainingPlan", "Unit " + promotion + " is the same previously promoted unit.");
/// DEBUG
			promotion = undefined;
		}
	}
	return types;
};

///
ARCH.TrainingPlan.prototype.Serialize = function () {
	return {
		"category": this.category,
		"type": this.type,
		"ID": this.ID,
		"metadata": this.metadata,
		"cost": this.cost.Serialize(),
		"number": this.number,
		"maxMerge": this.maxMerge
	};
};

ARCH.TrainingPlan.prototype.Deserialize = function (gameState, data) {
	for (let key in data)
		this[key] = data[key];

	this.cost = new API3.Resources();
	this.cost.Deserialize(data.cost);
};
///
