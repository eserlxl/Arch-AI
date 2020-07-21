let ARCH = function (m) {

	m.TrainingManager = function (Config) {
		this.Config = Config;
		this.maxPriority = Config.priorities["infantry"];

		this.lowPopulation = false;

		this.target = {
			"Support": 1,
			"Villager": 50,
			"Infantry": 50,
			"Cavalry": 10,
			"Guards": 0,
			"Healer": 0,
			"Army": 0,
			"Hero": 0
		};
		this.count = {
			"Support": 0,
			"Villager": 0,
			"Infantry": 0,
			"Cavalry": 0,
			"Guards": 0,
			"Healer": 0,
			"Army": 0,
			"Hero": 0
		};
		this.training = {};
		this.total = {
			"Support": 0,
			"Villager": 0,
			"Infantry": 0,
			"Cavalry": 0,
			"Guards": 0,
			"Healer": 0,
			"Army": 0,
			"Hero": 0
		};
		this.order = {
			"Support": false,
			"Villager": false,
			"Infantry": false,
			"Cavalry": false,
			"Guards": false,
			"Healer": false,
			"Army": false,
			"Hero": false
		};
		this.queueName = {
			"Support": "supportUnit",
			"Villager": "villager",
			"Infantry": "infantry",
			"Cavalry": "cavalry",
			"Guards": "guards",
			"Healer": "healer",
			"Army": "army",
			"Hero": "hero"
		};

		// TODO: Base data may be generated as in decide method. I don't think it's really necessary.
		this.metaData = {
			"Support": {
				"role": "worker",
				"base": 0,
				"plan": -1,
				"support": true,
				"type": "Support",
				"soldier": false
			},
			"Villager": {
				"role": "worker",
				"base": 0,
				"plan": -1,
				"support": true,
				"type": "Villager",
				"soldier": false
			},
			"Infantry": {
				"role": "worker",
				"base": 0,
				"plan": -1,
				"support": false,
				"type": "Infantry",
				"soldier": true
			},
			"Cavalry": {
				"role": "worker",
				"base": 0,
				"plan": -1,
				"support": false,
				"type": "Cavalry",
				"soldier": true
			},
			"Guards": {
				"role": "worker",
				"base": 0,
				"plan": -1,
				"type": "Guards",
				"soldier": true
			},
			"Healer": {
				"role": "support",
				"base": 0,
				"plan": -1,
				"type": "Healer",
				"soldier": false
			},
			"Army": {
				"role": "attacker",
				"base": 0,
				"plan": -1,
				"type": "Army",
				"soldier": false
			},
			"Hero": {
				"role": "defender",
				"base": 0,
				"plan": -1,
				"type": "Hero",
				"soldier": false
			}
		};
		this.emergency = {
			"Support": false,
			"Villager": false,
			"Infantry": false,
			"Cavalry": false,
			"Guards": false,
			"Healer": false,
			"Army": false,
			"Hero": false
		};
		// this.role = ["idle", "worker", "defence", "attacker"]; // Unused for now

		this.antiClass = {
			"Support": ["Melee", "Champion"],
			"Villager": ["Melee", "Soldier", "Infantry", "Elephant"],
			"Infantry": ["Support", "Cavalry"],
			"Cavalry": ["Support", "Infantry"],
			"Guards": ["Support", "Cavalry", "Chariot"],
			"Healer": ["Worker"],
			"Army": ["Support", "Worker"],
			"Hero": ["Support", "Worker"]
		};

		this.approvedClassList = {
			"Support": [],
			"Villager": [],
			"Infantry": [],
			"Cavalry": [],
			"Guards": [],
			"Healer": [],
			"Army": [],
			"Hero": []
		};

		this.initFlag = false;
		this.mainWorkerCount = 0;
		this.workerLimit = 50;
	};

	m.TrainingManager.prototype.init = function (gameState) {

		this.initPhase = gameState.currentPhase();
		this.initFlag = true;

		// Finding suitable classes according to the civilization
		this.classList = {
			"Support": ["Support", "Elephant"],
			"Infantry": ["Dog", "Infantry"],
			"Cavalry": ["Cavalry", "Chariot", "Camel"],
			"Guards": ["Dog", "Archer", "Javelin", "Maceman", "Pike", "Spear", "Sword"],
			"Army": ["Champion", "Siege"]
		};

		for (let type in this.classList) {
			for (let className in this.classList[type]) {
				let unitTemp = gameState.findTrainableUnits([this.classList[type][className]], this.antiClass[type]);
				if (unitTemp.length > 0) {
					this.approvedClassList[type].push(this.classList[type][className]);
				}
			}
		}
	};

	m.TrainingManager.prototype.update = function (gameState, queues) {

		// It should be updated for each new Phase
		if (!this.initFlag || this.initPhase !== gameState.currentPhase())
			this.init(gameState);

		this.currentPhase = gameState.currentPhase();
		this.population = gameState.getPopulation();
		this.baseCount = Math.max(1, gameState.ai.HQ.constructManager.baseCount);
		this.basicMilitaryBaseCount = gameState.ai.HQ.constructManager.basicMilitaryBaseCount;

		// Leave free population for ships
		if (gameState.ai.HQ.navalMap && this.population + this.Config.Navy.targetNumWarships - gameState.ai.HQ.navalManager.warShips.length >= gameState.getPopulationMax() && gameState.ai.HQ.constructManager.count["Dock"] > 0) {
/// DEBUG
			gameState.ai.logger.push("DEBUG", "TrainingManager", "Training manager was stopped to leave free space for ships.");
/// DEBUG
			return;
		}

		this.class = {
			"Villager": ["Worker", "Support"],
			"Healer": ["Support", "Healer"],
			"Hero": ["Hero"]
		};

		for (let type in this.classList) {
			this.class[type] = [pickRandom(this.approvedClassList[type])];
		}

		this.count = {
			"Support": 0,
			"Villager": 0,
			"Infantry": 0,
			"Cavalry": 0,
			"Guards": 0,
			"Healer": 0,
			"Army": 0,
			"Hero": 0
		};
		gameState.getOwnUnits().forEach(ent => {
			let type = ent.getMetadata(PlayerID, "type");
			let ship = ent.getMetadata(PlayerID, "ship");
			if (type && !ship) { // Exclude ships
				++this.count[type];
			}
		});

		let training = {
			"Support": 0,
			"Villager": 0,
			"Infantry": 0,
			"Cavalry": 0,
			"Guards": 0,
			"Healer": 0,
			"Army": 0,
			"Hero": 0
		};
		gameState.getOwnTrainingFacilities().forEach(function (ent) {
			for (let item of ent.trainingQueue()) {
				if (item.metadata && item.metadata["type"] && !item.metadata["ship"]) // Exclude ships
					++training[item.metadata["type"]];
			}
		});

		this.training = training;

		for (let type in this.training) {
			this.total[type] = this.count[type] + this.training[type];
		}

		this.resource = gameState.getResources(); // available (gathered) resources

		this.resourceScarcity = gameState.ai.HQ.resourceManager.scarcity({
			"food": this.Config.Economy.expectedResource["food"],
			"wood": this.Config.Economy.expectedResource["wood"],
			"metal": this.Config.Economy.expectedResource["metal"]
		});

		this.foodScarcity = gameState.ai.HQ.resourceManager.scarcity({
			"food": this.Config.Economy.expectedResource["food"]
		});

		this.woodScarcity = gameState.ai.HQ.resourceManager.scarcity({
			"wood": this.Config.Economy.expectedResource["wood"]
		});

		this.excessResource = !gameState.ai.HQ.resourceManager.scarcity({
			"food": 2 * this.Config.Economy.expectedResource["food"],
			"wood": 2 * this.Config.Economy.expectedResource["wood"],
			"metal": 2 * this.Config.Economy.expectedResource["metal"]
		});

		if (this.resource["food"] > 50) {
			if (this.resource["wood"] < 100) {
				this.target["Villager"]++;
			} else if (this.resource["stone"] < 0.5 * this.Config.Economy.expectedResource["stone"] || this.resource["metal"] < 0.5 * this.Config.Economy.expectedResource["metal"]) {
				this.target["Villager"]++;
				this.target["Infantry"]++;
			}
		}

		this.workerLimit = Math.max(50, gameState.getPopulationMax() / this.Config.phaseCount) * (1 + Math.sqrt(0.1 * this.currentPhase / this.Config.phaseCount));

		this.target["Villager"] = Math.min(this.target["Villager"], this.workerLimit);
		this.target["Infantry"] = Math.min(this.target["Infantry"], this.workerLimit);
		this.target["Cavalry"] = this.count["Infantry"] / 5;
		this.target["Support"] = this.count["Villager"] / Math.min(10, 30 / this.currentPhase);
		this.target["Guards"] = gameState.getPopulationLimit() / Math.pow(this.currentPhase, 1.1);
		this.target["Healer"] = this.currentPhase * 2;
		this.target["Army"] = gameState.getPopulationMax() - this.population;
		this.target["Hero"] = 1;

		/// Communist
		this.target["Healer"] = 0;
		/// Communist

		/// Theocrat
		this.target["Healer"] = this.currentPhase * 7;
		/// Theocrat

		this.mainWorkerCount = this.count["Villager"] + this.count["Infantry"];

		// First advance to Phase II, then build a market
		if (this.mainWorkerCount > m.limit(gameState.getPopulationMax() / 3, 50, 150)) {
			if ((this.foodScarcity || this.woodScarcity) && this.currentPhase === 1) {
/// DEBUG
				gameState.ai.logger.push("DEBUG", "TrainingManager", "Training manager was stopped to use resources for phasing up.");
/// DEBUG
				return;
			}

			if (this.woodScarcity && gameState.ai.HQ.constructManager.count["BarterMarket"] < Math.min(2, this.currentPhase)) {
/// DEBUG
				gameState.ai.logger.push("DEBUG", "TrainingManager", "Training manager was stopped to use resources market construction.");
/// DEBUG
				return;
			}
		}

		let maxTrainableInfantryCount = Math.min(15, Math.floor(Math.min(this.resource["food"] / 50, this.resource["wood"] / 50)));

		let size = {
			"Support": 1,
			"Villager": Math.min(5, Math.floor(this.resource["food"] / 50)),
			"Infantry": Math.min(5, maxTrainableInfantryCount),
			"Cavalry": this.currentPhase,
			"Guards": this.currentPhase,
			"Healer": 1,
			"Army": 1,
			"Hero": 1
		};

		let maxQueueCount = {
			"Support": this.baseCount,
			"Villager": 2 * this.baseCount,
			"Infantry": Math.max(2 * this.baseCount, this.basicMilitaryBaseCount),
			"Cavalry": this.currentPhase,
			"Guards": this.currentPhase,
			"Healer": this.currentPhase,
			"Army": this.currentPhase,
			"Hero": 1
		};

		this.lowPopulation = this.currentPhase < 3 || this.population < 0.9 * gameState.getPopulationMax();

		let rule = {
			"Support": this.lowPopulation && this.mainWorkerCount > 25 && this.resource["food"] > 0.5 * this.Config.Economy.expectedResource["food"],
			"Villager": this.lowPopulation && this.resource["wood"] < this.Config.Economy.expectedResource["wood"] && gameState.ai.HQ.resourceManager.idleVillagers < 3,
			"Infantry":
				this.lowPopulation
				&&
				(
					this.mainWorkerCount < 100
					|| this.currentPhase > 2
					|| !this.woodScarcity
				)
				&&
				(
					gameState.ai.playedTurn < gameState.ai.Config.Defence.rushProtectionTurn // Rush protection
					|| this.resource["food"] > 3000 * this.currentPhase / Math.max(1, this.count["Villager"])
					|| this.resource["wood"] > 3000 * this.currentPhase / Math.max(1, this.count["Villager"])
				),
			"Cavalry": !this.resourceScarcity && this.mainWorkerCount > 30 && this.lowPopulation,
			"Guards": !this.resourceScarcity && this.lowPopulation,
			"Healer": this.currentPhase > 1 && !this.resourceScarcity && this.lowPopulation,
			"Army": this.currentPhase > 2,
			"Hero": this.currentPhase > 2 && gameState.ai.HQ.constructManager.maxCount["Fortress"] > 0
		};

		let newOrder = false;
		for (let type in this.order) {
			this.order[type] = this.total[type] < this.target[type] && rule[type] && size[type] > 0;
			if (this.order[type]) {
				this.train(gameState, queues, type, size[type], this.emergency[type], maxQueueCount[type]);
				newOrder = true;
			}
		}

		if (!this.foodScarcity && this.lowPopulation) {
			// Always try to train a unit
			if (!newOrder) {
				if (!this.woodScarcity) {
/// DEBUG
					gameState.ai.logger.push("DEBUG", "TrainingManager", "Training an infantry to continue unit production.");
/// DEBUG
					this.train(gameState, queues, "Infantry", Math.max(1, size["Infantry"]), this.emergency["Infantry"], maxQueueCount["Infantry"]);
				}

				// Guards
				if (this.population > 50) {
/// DEBUG
					gameState.ai.logger.push("DEBUG", "TrainingManager", "Training Guards.");
/// DEBUG
					this.train(gameState, queues, "Guards", Math.max(this.currentPhase, maxTrainableInfantryCount), true, maxQueueCount["Guards"]);
				}
			}

			// Training Policy for Excess Resources
			if (this.currentPhase > 1 && this.excessResource) {
				if (gameState.ai.playedTurn < gameState.ai.Config.Defence.rushProtectionTurn) {
					this.train(gameState, queues, "Infantry", size["Infantry"], true, maxQueueCount["Infantry"]);
				} else {
					for (let type in this.order) {
						this.order[type] = type !== "Villager" && type !== "Support" && type !== "Healer" && size[type] > 0;
						if (this.order[type]) {
							this.train(gameState, queues, type, size[type], this.emergency[type], maxQueueCount[type]);
						}
					}
				}
			}
		}
	};

	/** picks the best template based on parameters and classes */
	m.TrainingManager.prototype.decide = function (gameState, classes, requirements) {
		let units;
		if (classes.indexOf("Hero") !== -1)
			units = gameState.findTrainableUnits(classes, []);
		else if (classes.indexOf("Siege") !== -1)	// We do not want siege tower as AI does not know how to use it
			units = gameState.findTrainableUnits(classes, ["SiegeTower"]);
		else						// We do not want hero when not explicitely specified
			units = gameState.findTrainableUnits(classes, ["Hero"]);

		if (!units.length)
			return undefined;

		let parameters = requirements.slice();
		let remainingResources = gameState.ai.HQ.getTotalResourceLevel(gameState);    // resources (estimation) still gatherable in our territory
		for (let type in remainingResources) {
			if (this.resource[type] > 2 * this.Config.Economy.expectedResource[type])
				continue;
			if (remainingResources[type] > 2 * this.Config.Economy.expectedResource[type])
				continue;
			let costsResource = remainingResources[type] > this.Config.Economy.expectedResource[type] ? 0.6 : 0.2;
			let toAdd = true;
			for (let param of parameters) {
				if (param[0] !== "costsResource" || param[2] !== type)
					continue;
				param[1] = Math.min(param[1], costsResource);
				toAdd = false;
				break;
			}
			if (toAdd)
				parameters.push(["costsResource", costsResource, type]);
		}

		units.sort((a, b) => {
			let aCost = 1 + a[1].costSum();
			let bCost = 1 + b[1].costSum();
			let aValue = 0.1;
			let bValue = 0.1;
			for (let param of parameters) {
				if (param[0] === "strength") {
					aValue += m.getMaxStrength(a[1]) * param[1];
					bValue += m.getMaxStrength(b[1]) * param[1];
				} else if (param[0] === "siegeStrength") {
					aValue += m.getMaxStrength(a[1], "Structure") * param[1];
					bValue += m.getMaxStrength(b[1], "Structure") * param[1];
				} else if (param[0] === "speed") {
					aValue += a[1].walkSpeed() * param[1];
					bValue += b[1].walkSpeed() * param[1];
				} else if (param[0] === "costsResource") {
					// requires a third parameter which is the resource
					if (a[1].cost()[param[2]])
						aValue *= param[1];
					if (b[1].cost()[param[2]])
						bValue *= param[1];
				} else if (param[0] === "canGather") {
					// checking against wood, could be anything else really.
					if (a[1].resourceGatherRates() && a[1].resourceGatherRates()["wood.tree"])
						aValue *= param[1];
					if (b[1].resourceGatherRates() && b[1].resourceGatherRates()["wood.tree"])
						bValue *= param[1];
				}
/// DEBUG
				else {
					gameState.ai.logger.push("WARNING", "TrainingManager", "Couldn't find a suitable unit to train. Constraints: " + uneval(param));
				}
/// DEBUG

			}
			return -aValue / aCost + bValue / bCost;
		});
		return units[0][0];
	};

	/**
	 * train with the highest priority ranged infantry in the nearest civil centre from a given set of positions
	 * and garrison them there for defence
	 */
	m.TrainingManager.prototype.emergencyDefender = function (gameState, positions) {
		if (gameState.ai.queues.emergency.plans.length > this.currentPhase * 5 || !this.lowPopulation)
			return false;

		let civ = gameState.getPlayerCiv();
		// find nearest base anchor
		let distcut = 20000;
		let nearestAnchor;
		let distmin;
		for (let pos of positions) {
			let access = gameState.ai.accessibility.getAccessValue(pos);
			// check nearest base anchor
			for (let base of gameState.ai.HQ.baseManagers) {
				if (!base.anchor || !base.anchor.position())
					continue;
				if (m.getLandAccess(gameState, base.anchor) !== access)
					continue;
				if (!base.anchor.trainableEntities(civ))	// base still in construction
					continue;
				let queue = base.anchor._entity.trainingQueue;
				if (queue) {
					let time = 0;
					for (let item of queue)
						if (item.progress > 0 || item.metadata && item.metadata.garrisonType)
							time += item.timeRemaining;
					if (time / 1000 > 5)
						continue;
				}
				let dist = API3.SquareVectorDistance(base.anchor.position(), pos);
				if (nearestAnchor && dist > distmin)
					continue;
				distmin = dist;
				nearestAnchor = base.anchor;
			}
		}
		if (!nearestAnchor || distmin > distcut)
			return false;

		// We will choose randomly ranged and melee units, except when garrisonHolder is full
		// in which case we prefer melee units
		let numGarrisoned = gameState.ai.HQ.garrisonManager.numberOfGarrisonedUnits(nearestAnchor);
		if (nearestAnchor._entity.trainingQueue) {
			for (let item of nearestAnchor._entity.trainingQueue) {
				if (item.metadata && item.metadata.garrisonType)
					numGarrisoned += item.count;
				else if (!item.progress && (!item.metadata || !item.metadata.trainer))
					nearestAnchor.stopProduction(item.id);
			}
		}
		let targetTemplate = ["Infantry", "CitizenSoldier"];

		let autogarrison = numGarrisoned < nearestAnchor.garrisonMax() &&
			nearestAnchor.hitpoints() > nearestAnchor.garrisonEjectHealth() * nearestAnchor.maxHitpoints();
		if (autogarrison) {
			targetTemplate.push("Ranged");
		}

		let total = gameState.getResources();
		let templateFound;
		let trainables = nearestAnchor.trainableEntities(civ);
		let garrisonArrowClasses = nearestAnchor.getGarrisonArrowClasses();
		for (let trainable of trainables) {
			if (gameState.isTemplateDisabled(trainable))
				continue;
			let template = gameState.getTemplate(trainable);

			if (!template || (autogarrison && !MatchesClassList(template.classes(), garrisonArrowClasses)))
				continue;

			if (template && template.hasClass(pickRandom(targetTemplate))) {
				if (total.canAfford(new API3.Resources(template.cost())))
					templateFound = [trainable, template];
				break;
			}
		}
		if (!templateFound)
			return false;

		// Check first if we can afford it without touching the other accounts
		// and if not, take some of other accounted resources
		// TODO sort the queues to be substracted
		let queueManager = gameState.ai.queueManager;
		let cost = new API3.Resources(templateFound[1].cost());
		queueManager.setAccounts(gameState, cost, "emergency");
		if (!queueManager.canAfford("emergency", cost)) {
			for (let q in queueManager.queues) {
				if (q === "emergency")
					continue;
				queueManager.transferAccounts(cost, q, "emergency");
				if (queueManager.canAfford("emergency", cost))
					break;
			}
		}
		let metadata = {
			"role": "worker",
			"base": nearestAnchor.getMetadata(PlayerID, "base"),
			"plan": -1,
			"type": "Guards",
			"soldier": true,
			"trainer": nearestAnchor.id()
		};
		if (autogarrison)
			metadata.garrisonType = "protection";
/// DEBUG
		gameState.ai.logger.push("DEBUG", "TrainingManager", "Training emergency defender: " + templateFound[0]);
/// DEBUG

		gameState.ai.queues.emergency.addPlan(new m.TrainingPlan(gameState, templateFound[0], metadata, this.currentPhase, this.currentPhase));
		return true;
	};

	m.TrainingManager.prototype.train = function (gameState, queues, type, queueSize = 1, emergency = false, maxQueueCount = 1) {

/// DEBUG
		gameState.ai.logger.push("DEBUG", "TrainingManager", "Starting to train unit type: " + type, 1000);
/// DEBUG

		let queueObject = queues[this.queueName[type]];
		let queueArray = Object(queueObject);

		let numTraining = 0;
		let numTrainingFacility = 0;
		for (let ent of gameState.getOwnTrainingFacilities().values()) {
			for (let item of ent.trainingQueue()) {
				if (!item.metadata || !item.metadata.type || item.metadata.type !== type)
					continue;
				numTraining += item.count;
				numTrainingFacility++;
			}
		}

		if (numTraining / numTrainingFacility > maxQueueCount) { //  && !emergency
/// DEBUG
			gameState.ai.logger.push("WARNING", "TrainingManager", "Training halted due to prevent multiple orders for " + type + " in a training queue!", 1000);
/// DEBUG
			return false;
		}

		let trainTemplate = gameState.findTrainableUnits(this.class[type], this.antiClass[type]);

		if (!trainTemplate || trainTemplate.length === 0) {
/// DEBUG
			gameState.ai.logger.push("WARNING", "TrainingManager", "Training halted due to unknown training template! Template: " + trainTemplate + " maxQueueCount: " + trainTemplate.length + " class " + this.class[type] + " antiClass " + this.antiClass[type], 1000);
/// DEBUG

			// Refreshing the approved list cache
			this.init(gameState);
			return false;
		}

		let templateIndex = randIntExclusive(0, trainTemplate.length);

		if (emergency) { // It should be used only for queues that includes multiple different units

			let queueName = "emergency";
			queueObject = queues[queueName];

			let template = gameState.getTemplate(trainTemplate[templateIndex][0]);

			if (!template) {
/// DEBUG
				gameState.ai.logger.push("WARNING", "TrainingManager", "Training halted due to unknown unit template!", 1000);
/// DEBUG
				return false;
			}

			// Check first if we can afford it without touching the other accounts
			// If not, take some other accounted resources
			// TODO sort the queues to be substracted
			let queueManager = gameState.ai.queueManager;
			let cost = new API3.Resources(template.cost());
			queueManager.setAccounts(gameState, cost, queueName);
			if (!queueManager.canAfford(queueName, cost)) {
				for (let q in queueManager.queues) {
					if (q === queueName)
						continue;
					queueManager.transferAccounts(cost, q, queueName);
					if (queueManager.canAfford(queueName, cost))
						break;
				}
			}
		}
/// DEBUG
		gameState.ai.logger.push("DEBUG", "TrainingManager", "Planing to train type: " + type, 1000);
/// DEBUG

		queueObject.addPlan(new m.TrainingPlan(gameState, trainTemplate[templateIndex][0], this.metaData[type], queueSize, queueSize));

/// DEBUG
		gameState.ai.logger.push("DEBUG", "TrainingManager", "Basic Unit Counts =>" + "\n" +
			" Support: " + this.count["Support"] + "/" + this.target["Support"] + "\n" +
			" Villager: " + this.count["Villager"] + "/" + this.target["Villager"] + "\n" +
			" Infantry: " + this.count["Infantry"] + "/" + this.target["Infantry"] + "\n" +
			" Cavalry: " + this.count["Cavalry"] + "/" + this.target["Cavalry"] + "\n" +
			" Guards: " + this.count["Guards"] + "/" + this.target["Guards"] + "\n" +
			" Healer: " + this.count["Healer"] + "/" + this.target["Healer"] + "\n" +
			" Army: " + this.count["Army"] + "/" + this.target["Army"] + "\n" +
			" Hero: " + this.count["Hero"] + "/" + this.target["Hero"]);
/// DEBUG

		return true;
	};

///
	m.TrainingManager.prototype.Serialize = function () {
		return {
			"test": true
		};
	};

	m.TrainingManager.prototype.Deserialize = function (gameState, data) {
		for (let key in data) {
			this[key] = data[key];
		}
	};
///
	return m;

}(ARCH);
