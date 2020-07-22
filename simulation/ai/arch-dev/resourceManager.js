ARCH.ResourceManager = function (Config) {
	this.Config = Config;
	this.fieldRequired = 0;
	this.fieldUpdateTurn = 0;
	this.idleVillagers = 0;
	this.idleInfantry = 0;
	this.idleWorkers = 0;
	this.mainWorkers = 0;
};

ARCH.ResourceManager.prototype.update = function (gameState, queues) {
	this.resource = gameState.getResources();
	this.currentPhase = gameState.currentPhase();

	this.checkWorkers(gameState);

	gameState.ai.HQ.constructManager.target["Field"] = this.field(gameState);
/// DEBUG
	gameState.ai.logger.push("DEBUG", "ResourceManager", "Target Field: " + gameState.ai.HQ.constructManager.target["Field"]);
/// DEBUG

	this.corral(gameState, queues);
};

ARCH.ResourceManager.prototype.scarcity = function (required) {
	if (this.resource) {
		for (let res in required) {
			if (this.resource[res] < required[res]) {
				return true;
			}
		}
	}
	return false;
};

ARCH.ResourceManager.prototype.findJob = function (gameState, ent) {

	let required = ["food", "wood"];
	if (ARCH.checkPhase(gameState, 2)) {
		required.push("stone");
		required.push("metal");
	}

	let gain = 1;
	let requiredResource = false;
	while (this.resource && !requiredResource) {
		for (let res of required) {
			if (this.resource[res] < gain * this.Config.Economy.expectedResource[res]) {
				requiredResource = res;
				break;
			}
		}
		gain++;
	}

	gameState.ai.HQ.baseManagers[0].reassignIdleWorkers(gameState, [ent], requiredResource);
};

ARCH.ResourceManager.prototype.checkWorkers = function (gameState) {
	this.idleVillagers = 0;
	this.idleInfantry = 0;
	this.idleWorkers = 0;
	this.mainWorkers = 0;

	for (let ent of gameState.getOwnUnits().values()) {
		let type = ent.getMetadata(PlayerID, "type");
		let subrole = ent.getMetadata(PlayerID, "subrole");
		if (!ent.position() // Check that the worker isn't garrisoned
			|| !type || type === "Support" || ent.hasClass("Champion")) {
			continue;
		}

		if (type === "Villager" || type === "Infantry" || type === "Guards") {
			this.mainWorkers++;

			if (subrole === "idle") {
				this.idleWorkers++;

				if (type === "Villager") {
					this.idleVillagers++;
				} else {
					this.idleInfantry++;
				}

				if (!gameState.ai.HQ.defenceManager.stillDangerous) {
					this.findJob(gameState, ent);
				}
			}
		}
	}
};

/** Train animals at corral */
ARCH.ResourceManager.prototype.corral = function (gameState, queues) {
	if (queues.corral.hasQueuedUnits() || this.resource["food"] > 5000 || this.mainWorkers < gameState.getPopulationMax() / 2)
		return;

	// Try to research corral technologies
	gameState.ai.HQ.researchManager.researchCorral(gameState, queues);

	let maxQueueSize = 5 * this.currentPhase;
	let availableFood = this.resource["food"] - this.currentPhase * 50;
	let civ = gameState.getPlayerCiv();
	for (let corral of gameState.getOwnEntitiesByClass("Corral", true).values()) {
		if (corral.foundationProgress() !== undefined || corral.trainingQueue().length > 0)
			continue;
		let bestOption = false;
		let minCost = 1e6;
		let trainables = corral.trainableEntities(civ);
		let i = 0;
		for (let trainable of trainables) {
			if (gameState.isTemplateDisabled(trainable))
				continue;
			let template = gameState.getTemplate(trainable);
			if (!template || !template.isHuntable())
				continue;

			// Optimization: For available food higher than 375, zebu is better than goat for breeding
			let unitCost = template.cost();
			unitCost["time"] = template._template["Cost"]["BuildTime"];
			let size = Math.min(maxQueueSize, availableFood / unitCost["food"]);
			let foodGain = size * (template._template["ResourceSupply"]["Amount"] - unitCost["food"]);
			let gatheringSpeed = 1;
			let killTime = template._template["Health"]["Max"] / 22; // Average
			let otherTimeLoss = 3;
			let breedingTime = Math.pow(size, 0, 7) * unitCost["time"];
			let gatheringTime = size * (template._template["ResourceSupply"]["Amount"] / gatheringSpeed + killTime + otherTimeLoss)
			let totalTimeReq = breedingTime + gatheringTime;

			let cost = totalTimeReq / foodGain;
/// DEBUG
			gameState.ai.logger.push("DEBUG", "ResourceManager", "Available animal to breed: " + template._templateName + " cost: " + cost + " totalTimeReq: " + totalTimeReq + " foodGain: " + foodGain);
/// DEBUG

			if (cost < minCost) {
				minCost = cost;
				bestOption = template._templateName;
			}
		}

		if (bestOption) {
/// DEBUG
			gameState.ai.logger.push("DEBUG", "ResourceManager", "The best profitable animal to breed: " + bestOption);
/// DEBUG
			let template = gameState.getTemplate(bestOption);

			let size = Math.min(maxQueueSize, Math.floor(availableFood / template.cost()["food"]));
			if (size > 0) {
				queues.corral.addPlan(new ARCH.TrainingPlan(gameState, bestOption, {"trainer": corral.id()}, size, size));
				break;
			}
		}
	}
};

ARCH.ResourceManager.prototype.field = function (gameState) {
	if (this.resource["food"] > 250 * this.currentPhase) {
		return 4 * this.currentPhase;
	} else if (this.fieldUpdateTurn < gameState.ai.playedTurn - 15) {
		this.fieldRequired += 0.001 * this.currentPhase * (250 - this.resource["food"]);

		this.fieldRequired = ARCH.limit(this.fieldRequired, 0, this.Config.Economy.maxFieldCount);

		this.fieldUpdateTurn = gameState.ai.playedTurn;
/// DEBUG
		gameState.ai.logger.push("DEBUG", "ResourceManager", "Field Count Limit: " + this.Config.Economy.maxFieldCount + " Required Field Count: " + this.fieldRequired);
/// DEBUG
	}

	return Math.max(4 * this.currentPhase, this.fieldRequired);
};


///
ARCH.ResourceManager.prototype.Serialize = function () {
};

ARCH.ResourceManager.prototype.Deserialize = function (data) {
	for (let key in data)
		this[key] = data[key];
};
///