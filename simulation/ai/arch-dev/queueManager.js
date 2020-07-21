let ARCH = function (m) {

// This takes the input queues and picks which items to fund with resources until no more resources are left to distribute.
//
// Currently this manager keeps accounts for each queue, split between the 4 main resources
//
// Each time resources are available (ie not in any account), it is split between the different queues
// Mostly based on priority of the queue, and existing needs.
// Each turn, the queue Manager checks if a queue can afford its next item, then it does.
//
// A consequence of the system it's not really revertible. Once a queue has an account of 500 food, it'll keep it
// If for some reason the AI stops getting new food, and this queue lacks, say, wood, no other queues will
// be able to benefit form the 500 food (even if they only needed food).
// This is not to annoying as long as all goes well. If the AI loses many workers, it starts being problematic.
//
// It also has the effect of making the AI more or less always sit on a few hundreds resources since most queues
// get some part of the total, and if all queues have 70% of their needs, nothing gets done
// Particularly noticeable when phasing: the AI often overshoots by a good 200/300 resources before starting.
//
// This system should be improved. It's probably not flexible enough.

	m.QueueManager = function (Config, queues) {
		this.Config = Config;
		this.queues = queues;
		this.priorities = {};
		for (let i in Config.priorities)
			this.priorities[i] = Config.priorities[i];
		this.accounts = {};

		// the sorting is updated on priority change.
		this.queueArrays = [];
		for (let q in this.queues) {
			this.accounts[q] = new API3.Resources();
			this.queueArrays.push([q, this.queues[q]]);
		}
		let priorities = this.priorities;
		this.queueArrays.sort((a, b) => priorities[b[0]] - priorities[a[0]]);
	};

	m.QueueManager.prototype.init = function (gameState) {
		this.logger = gameState.ai.logger;
	};

	m.QueueManager.prototype.getAvailableResources = function (gameState) {
		let resources = gameState.getResources();
		for (let key in this.queues)
			resources.subtract(this.accounts[key]);
		return resources;
	};

	m.QueueManager.prototype.getTotalAccountedResources = function () {
		let resources = new API3.Resources();
		for (let key in this.queues)
			resources.add(this.accounts[key]);
		return resources;
	};

	m.QueueManager.prototype.currentNeeds = function (gameState) {
		let needed = new API3.Resources();
		// queueArrays because it's faster.
		for (let q of this.queueArrays) {
			let queue = q[1];
			if (!queue.hasQueuedUnits())
				continue;
			let costs = queue.plans[0].getCost();
			needed.add(costs);
		}
		// get out current resources, not removing accounts.
		let current = gameState.getResources();
		for (let res of Resources.GetCodes())
			needed[res] = Math.max(0, needed[res] - current[res]);

		return needed;
	};

// calculate the gather rates we'd want to be able to start all elements in our queues
	m.QueueManager.prototype.wantedGatherRates = function (gameState, requiredResource = false) {
		// default values for first turn when we have not yet set our queues.
		if (gameState.ai.playedTurn === 0) {
			let ret = {};
			for (let res of Resources.GetCodes())
				ret[res] = this.Config.queues.firstTurn[res] || this.Config.queues.firstTurn.default;
			return ret;
		}

		// get out current resources, not removing accounts.
		let current = gameState.getResources();
		// short queue is the first item of a queue, assumed to be ready in 30s
		// medium queue is the second item of a queue, assumed to be ready in 60s
		// long queue is the rest of the items in a queue, assumed to be ready in 300s
		let totalShort = {};
		let totalMedium = {};
		let totalLong = {};
		for (let res of Resources.GetCodes()) {
			totalShort[res] = this.Config.queues.short[res] || this.Config.queues.short.default;
			totalMedium[res] = this.Config.queues.medium[res] || this.Config.queues.medium.default;
			totalLong[res] = this.Config.queues.long[res] || this.Config.queues.long.default;
		}
		let total;
		// queueArrays because it's faster.
		for (let q of this.queueArrays) {
			let queue = q[1];
			if (queue.paused)
				continue;
			for (let j = 0; j < queue.length(); ++j) {
				if (j > 1)
					break;
				let cost = queue.plans[j].getCost();
				if (j === 0)
					total = totalShort;
				else if (j < 2)
					total = totalMedium;
				else
					total = totalLong;
				for (let type in total)
					total[type] += cost[type];
			}
		}
		// global rates
		let rates = {};
		let diff;
		for (let res of Resources.GetCodes()) {

			if (!requiredResource) {
				// Phase 1 Gathering Policy
				if (gameState.currentPhase() === 1) {
					// If we don't have any basic military bases, keep working for food, wood and stone, but delist metal
					if ((gameState.ai.HQ.constructManager.basicMilitaryBaseCount === 0 && res === "metal")
						// Delist other resources until we have enough workers
						|| (res !== "food" && gameState.ai.HQ.trainingManager.mainWorkerCount < 30)) {
						// Do not delist wood until we have enough wood
						if (res !== "wood" || current["wood"] > 500)
							continue;
					}
					// If we have enough basic military bases, delist stone and metal
					else if (res === "stone" || res === "metal") {
						continue;
					}
				}
				// Phase 2 Gathering Policy
				else if (gameState.currentPhase() === 2) {
					// Always stock enough food and wood
					if ((res === "stone" || res === "metal")
						&& gameState.ai.HQ.trainingManager.mainWorkerCount < 100
						&& current["metal"] > 1000
						&& current["stone"] > 1000
						&& (current["food"] < 500 || current["wood"] < 500)
					) {
						continue;
					}
				}
			} else if (res !== requiredResource) {
				continue;
			}


			if (current[res] > 0) {
				diff = Math.min(current[res], totalShort[res]);
				totalShort[res] -= diff;
				current[res] -= diff;
				if (current[res] > 0) {
					diff = Math.min(current[res], totalMedium[res]);
					totalMedium[res] -= diff;
					current[res] -= diff;
					if (current[res] > 0)
						totalLong[res] -= Math.min(current[res], totalLong[res]);
				}
			}
			rates[res] = totalShort[res] / 30 + totalMedium[res] / 60 + totalLong[res] / 300;
		}

		return rates;
	};

/// DEBUG
	m.QueueManager.prototype.printQueues = function (gameState) {

		for (let i in this.queues) {
			let q = this.queues[i];

			if (q.hasQueuedUnits()) {
				gameState.ai.logger.push("DEBUG", "QueueManager", "Queue has already tasks: " + i + " ( with priority " + this.priorities[i] + " and accounts " + uneval(this.accounts[i]) + ")");
			}

			for (let plan of q.plans) {
				let qStr = "     " + plan.type + " ";
				if (plan.number)
					qStr += "x" + plan.number;
				gameState.ai.logger.push("DEBUG", "QueueManager", "Plans of this queue: " + qStr);
			}
		}

		for (let p in this.accounts) {
			gameState.ai.logger.push("DEBUG", "QueueManager", "Account components: " + p + ": " + uneval(this.accounts[p]));
		}
		gameState.ai.logger.push("DEBUG", "QueueManager", "Current Resources: " + uneval(gameState.getResources()));
		gameState.ai.logger.push("DEBUG", "QueueManager", "Available Resources: " + uneval(this.getAvailableResources(gameState)));
		gameState.ai.logger.push("DEBUG", "QueueManager", "Wanted Gather Rates: " + uneval(gameState.ai.HQ.GetWantedGatherRates(gameState)));
		gameState.ai.logger.push("DEBUG", "QueueManager", "Current Gather Rates: " + uneval(gameState.ai.HQ.GetCurrentGatherRates(gameState)));
		gameState.ai.logger.push("DEBUG", "QueueManager", "Most needed resources: " + uneval(gameState.ai.HQ.pickMostNeededResources(gameState)));
	};
/// DEBUG

	m.QueueManager.prototype.clear = function () {
		for (let i in this.queues)
			this.queues[i].empty();
	};

	/**
	 * set accounts of queue i from the unaccounted resources
	 */
	m.QueueManager.prototype.setAccounts = function (gameState, cost, i) {
		let available = this.getAvailableResources(gameState);
		for (let res of Resources.GetCodes()) {
			if (this.accounts[i][res] >= cost[res])
				continue;
			this.accounts[i][res] += Math.min(available[res], cost[res] - this.accounts[i][res]);
		}
	};

	/**
	 * transfer accounts from queue i to queue j
	 */
	m.QueueManager.prototype.transferAccounts = function (cost, i, j) {
		for (let res of Resources.GetCodes()) {
			if (this.accounts[j][res] >= cost[res])
				continue;
			let diff = Math.min(this.accounts[i][res], cost[res] - this.accounts[j][res]);
			this.accounts[i][res] -= diff;
			this.accounts[j][res] += diff;
		}
	};

	/**
	 * distribute the resources between the different queues according to their priorities
	 */
	m.QueueManager.prototype.distributeResources = function (gameState) {
		let availableRes = this.getAvailableResources(gameState);
		for (let res of Resources.GetCodes()) {
			if (availableRes[res] < 0)    // rescale the accounts if we've spent resources already accounted (e.g. by bartering)
			{
				let total = gameState.getResources()[res];
				let scale = total / (total - availableRes[res]);
				availableRes[res] = total;
				for (let j in this.queues) {
					this.accounts[j][res] = Math.floor(scale * this.accounts[j][res]);
					availableRes[res] -= this.accounts[j][res];
				}
			}

			if (!availableRes[res]) {
				this.switchResource(gameState, res);
				continue;
			}

			if (this.Config.Economy.disableResourcePlaning) {
				for (let q in this.queues) {
					let queueCost = this.queues[q].maxAccountWanted(gameState, 0);
					if (this.queues[q].hasQueuedUnits() && this.accounts[q][res] < queueCost[res] && !this.queues[q].paused) {
						this.accounts[q][res] = queueCost[res];
					}
				}

				continue;
			}

			let totalPriority = 0;
			let tempPrio = {};
			let maxNeed = {};
			// Okay so this is where it gets complicated.
			// If a queue requires "res" for the next elements (in the queue)
			// And the account is not high enough for it.
			// Then we add it to the total priority.
			// To try and be clever, we don't want a long queue to hog all resources. So two things:
			//	-if a queue has enough of resource X for the 1st element, its priority is decreased (factor 2).
			//	-queues accounts are capped at "resources for the first + 60% of the next"
			// This avoids getting a high priority queue with many elements hogging all of one resource
			// uselessly while it awaits for other resources.
			for (let j in this.queues) {
				// returns exactly the correct amount, ie 0 if we're not go.
				let queueCost = this.queues[j].maxAccountWanted(gameState, 0.6);
				if (this.queues[j].hasQueuedUnits() && this.accounts[j][res] < queueCost[res] && !this.queues[j].paused) {
					// adding us to the list of queues that need an update.
					tempPrio[j] = this.priorities[j];
					maxNeed[j] = queueCost[res] - this.accounts[j][res];
					// if we have enough of that resource for our first item in the queue, diminish our priority.
					if (this.accounts[j][res] >= this.queues[j].getNext().getCost()[res])
						tempPrio[j] *= 0.9;

					if (tempPrio[j])
						totalPriority += tempPrio[j];
				} else if (this.accounts[j][res] > queueCost[res]) {
					availableRes[res] += this.accounts[j][res] - queueCost[res];
					this.accounts[j][res] = queueCost[res];
				}
			}
			// Now we allow resources to the accounts. We can at most allow "TempPriority/totalpriority*available"
			// But we'll sometimes allow less if that would overflow.
			let available = availableRes[res];
			let missing = false;
			for (let j in tempPrio) {
				// we'll add at much what can be allowed to this queue.
				let toAdd = Math.floor(availableRes[res] * tempPrio[j] / totalPriority);
				if (toAdd >= maxNeed[j])
					toAdd = maxNeed[j];
				else
					missing = true;
				this.accounts[j][res] += toAdd;
				maxNeed[j] -= toAdd;
				available -= toAdd;
			}
			if (missing && available > 0)   // distribute the rest (due to floor) in any queue
			{
				for (let j in tempPrio) {
					let toAdd = Math.min(maxNeed[j], available);
					this.accounts[j][res] += toAdd;
					available -= toAdd;
					if (available <= 0)
						break;
				}
			}
/// DEBUG
			if (available < 0) {
				gameState.ai.logger.push("ERROR", "QueueManager", "Problem with remaining " + res + " is only " + available + ".");
			}
/// DEBUG
		}
	};

	m.QueueManager.prototype.switchResource = function (gameState, res) {
		// We have no available resources, see if we can't "compact" them in one queue.
		// compare queues 2 by 2, and if one with a higher priority could be completed by our amount, give it.
		// TODO: this isn't perfect compression.
		for (let j in this.queues) {
			if (!this.queues[j].hasQueuedUnits() || this.queues[j].paused)
				continue;

			let queue = this.queues[j];
			let queueCost = queue.maxAccountWanted(gameState, 0);
			if (this.accounts[j][res] >= queueCost[res])
				continue;

			for (let i in this.queues) {
				if (i === j)
					continue;
				let otherQueue = this.queues[i];
				if (this.priorities[i] >= this.priorities[j] || otherQueue.switched !== 0)
					continue;
				if (this.accounts[j][res] + this.accounts[i][res] < queueCost[res])
					continue;

				let diff = queueCost[res] - this.accounts[j][res];
				this.accounts[j][res] += diff;
				this.accounts[i][res] -= diff;
				++otherQueue.switched;
/// DEBUG
				gameState.ai.logger.push("DEBUG", "QueueManager", "Switching queue " + res + " from " + i + " to " + j + " in amount " + diff + ".");
/// DEBUG
				break;
			}
		}
	};

// Start the next item in the queue if we can afford it.
	m.QueueManager.prototype.startNextItems = function (gameState) {

		for (let q of this.queueArrays) {
			let name = q[0];
			let queue = q[1];

			if (queue.hasQueuedUnits()) {
/// DEBUG
				gameState.ai.logger.push("DEBUG", "QueueManager", name + " queue has already tasks.");
/// DEBUG
			}
			if (queue.paused) {
/// DEBUG
				gameState.ai.logger.push("WARNING", "QueueManager", name + " queue was paused.");
/// DEBUG
			}

			if (queue.hasQueuedUnits() && !queue.paused) {
				let item = queue.getNext();
				if (this.accounts[name].canAfford(item.getCost()) && item.canStart(gameState)) {
/// DEBUG
					gameState.ai.logger.push("DEBUG", "QueueManager", name + " queue can afford its task and the task can be started.");
/// DEBUG
					// canStart may update the cost because of the costMultiplier so we must check it again
					if (this.accounts[name].canAfford(item.getCost())) {
						this.finishingTime = gameState.ai.elapsedTime;
						this.accounts[name].subtract(item.getCost());
						queue.startNext(gameState);
/// DEBUG
						gameState.ai.logger.push("DEBUG", "QueueManager", name + " queue task was started.");
/// DEBUG
						queue.switched = 0;
					}
				}
			} else if (!queue.hasQueuedUnits()) {
				this.accounts[name].reset();
				queue.switched = 0;
			}
		}
	};

	m.QueueManager.prototype.update = function (gameState) {
///
		Engine.ProfileStart("Queue Manager");
///
		for (let q in this.queues) {
			if (!this.queues[q].hasQueuedUnits()) {
				this.changePriority(q, gameState.ai.Config.priorities[q]);
			} else {
				this.queues[q].check(gameState);
			}
			if (this.priorities[q] > 0)
				continue;
/// DEBUG
			gameState.ai.logger.push("ERROR", "QueueManager", "Bad priorities, please report this error: " + uneval(this.priorities));
/// DEBUG
			this.priorities[q] = 1;  // TODO: make the Queue Manager not die when priorities are zero.
		}

		this.sortQueues();

		// Pause or unpause queues depending on the situation
		this.checkPausedQueues(gameState);

		// Let's assign resources to plans that need them
		this.distributeResources(gameState);

		// Start the next item in the queue if we can afford it.
		this.startNextItems(gameState);
/// DEBUG
		this.printQueues(gameState);
/// DEBUG
///
		Engine.ProfileStop();
///
	};

// Recovery system: if short of workers after an attack, pause (and reset) some queues to favor worker training
	m.QueueManager.prototype.checkPausedQueues = function (gameState) {
		let workerCount = gameState.ai.HQ.trainingManager.mainWorkerCount;
		let targetWorkerCount = gameState.ai.HQ.trainingManager.target["Villager"] + gameState.ai.HQ.trainingManager.target["Infantry"];
		for (let q in this.queues) {
			// Never pause major queues!
			if (q === "emergency" || q === "house" || q === "dock" || q === "market" || q === "civilCentre" || q === "majorTech" || q === "military" || q === "defence" || q === "guards" || q === "army")
				continue;

			// Rush protection
			if (gameState.ai.playedTurn < gameState.ai.Config.Defence.rushProtectionTurn && (q === "villager" || q === "infantry")) {
				continue;
			}

			/// Admiral
			if (q === "ships") continue;
			/// Admiral

			/// Mercantilist
			if (q === "trader") continue;
			/// Mercantilist

			/// Patriot
			if (q === "army") continue;
			/// Patriot

			/// Theocrat
			if (q === "temple" || q === "healer") continue;
			/// Theocrat

			let toBePaused = false;
			if (workerCount < targetWorkerCount / 3)
				toBePaused = q !== "infantry" && q !== "villager";
			else if (workerCount < targetWorkerCount * 2 / 3) // 	q === "majorTech" ||
				toBePaused = q === "economicBuilding" ||
					q === "militaryBuilding" || q === "defenceBuilding" || q === "healer"
					|| q === "minorTech"; //  || q.indexOf("plan_") !== -1
			else if (workerCount < targetWorkerCount) // 	q === "majorTech" ||
				toBePaused = q === "defenceBuilding" || q.indexOf("_siege") !== -1 || q.indexOf("_champ") !== -1;

			if (toBePaused) {
				if (q === "field" || q === "villager" || q === "supportUnit")
					toBePaused = false;
				if (q === "ships" && gameState.ai.HQ.needFish &&
					!gameState.ai.HQ.navalManager.ships.filter(API3.Filters.byClass("FishingBoat")).hasEntities())
					toBePaused = false;
			}

			let queue = this.queues[q];
			if (!queue.paused && toBePaused) {
				queue.paused = true;
				this.accounts[q].reset();
			} else if (queue.paused && !toBePaused)
				queue.paused = false;

			// And reduce the batch sizes of attack queues
			if (q.indexOf("plan_") !== -1 && workerCount < targetWorkerCount && queue.plans[0]) {
				queue.plans[0].number = 1;
				if (queue.plans[1])
					queue.plans[1].number = 1;
			}
		}
	};

	m.QueueManager.prototype.canAfford = function (queue, cost) {
		if (!this.accounts[queue])
			return false;
		return this.accounts[queue].canAfford(cost);
	};

	m.QueueManager.prototype.pauseQueue = function (queue, scrapAccounts) {
		if (!this.queues[queue])
			return;
		this.queues[queue].paused = true;
		if (scrapAccounts)
			this.accounts[queue].reset();
	};

	m.QueueManager.prototype.unpauseQueue = function (queue) {
		if (this.queues[queue])
			this.queues[queue].paused = false;
	};

	m.QueueManager.prototype.pauseAll = function (scrapAccounts, but) {
		for (let q in this.queues) {
			if (q === but)
				continue;
			if (scrapAccounts)
				this.accounts[q].reset();
			this.queues[q].paused = true;
		}
	};

	m.QueueManager.prototype.unpauseAll = function (but) {
		for (let q in this.queues)
			if (q !== but)
				this.queues[q].paused = false;
	};


	m.QueueManager.prototype.addQueue = function (queueName, priority) {
		if (this.queues[queueName] !== undefined)
			return;

		this.queues[queueName] = new m.Queue();
		this.priorities[queueName] = priority;
		this.accounts[queueName] = new API3.Resources();

		this.queueArrays = [];
		for (let q in this.queues)
			this.queueArrays.push([q, this.queues[q]]);
		let priorities = this.priorities;
		this.queueArrays.sort((a, b) => priorities[b[0]] - priorities[a[0]]);
	};

	m.QueueManager.prototype.removeQueue = function (queueName) {
		if (this.queues[queueName] === undefined)
			return;

		delete this.queues[queueName];
		delete this.priorities[queueName];
		delete this.accounts[queueName];

		this.queueArrays = [];
		for (let q in this.queues)
			this.queueArrays.push([q, this.queues[q]]);
		let priorities = this.priorities;
		this.queueArrays.sort((a, b) => priorities[b[0]] - priorities[a[0]]);
	};

	m.QueueManager.prototype.getPriority = function (queueName) {
		return this.priorities[queueName];
	};

	m.QueueManager.prototype.changePriority = function (queueName, newPriority) {
/// DEBUG
		this.logger.push("DEBUG", "QueueManager", "Priority of queue " + queueName + " changed from " + this.priorities[queueName] + " to " + newPriority);
/// DEBUG
		if (this.queues[queueName] !== undefined)
			this.priorities[queueName] = newPriority;
	};

	m.QueueManager.prototype.sortQueues = function () {
		let priorities = this.priorities;
		this.queueArrays.sort((a, b) => priorities[b[0]] - priorities[a[0]]);
	};

///
	m.QueueManager.prototype.Serialize = function () {
		let accounts = {};
		let queues = {};
		for (let q in this.queues) {
			queues[q] = this.queues[q].Serialize();
			accounts[q] = this.accounts[q].Serialize();

			API3.warn("queueManager serialization: queue " + q + " >>> " +
				uneval(queues[q]) + " with accounts " + uneval(accounts[q]));

		}

		return {
			"priorities": this.priorities,
			"queues": queues,
			"accounts": accounts
		};
	};

	m.QueueManager.prototype.Deserialize = function (gameState, data) {
		this.priorities = data.priorities;
		this.queues = {};
		this.accounts = {};

		// the sorting is updated on priority change.
		this.queueArrays = [];
		for (let q in data.queues) {
			this.queues[q] = new m.Queue();
			this.queues[q].Deserialize(gameState, data.queues[q]);
			this.accounts[q] = new API3.Resources();
			this.accounts[q].Deserialize(data.accounts[q]);
			this.queueArrays.push([q, this.queues[q]]);
		}
		this.queueArrays.sort((a, b) => data.priorities[b[0]] - data.priorities[a[0]]);
	};
///
	return m;
}(ARCH);
