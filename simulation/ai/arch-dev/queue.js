/**
 * Holds a list of wanted plans to train or construct
 */

ARCH.Queue = function () {
	this.plans = [];
	this.paused = false;
	this.switched = 0;
};

ARCH.Queue.prototype.empty = function () {
	this.plans = [];
};

ARCH.Queue.prototype.addPlan = function (newPlan) {
	if (!newPlan)
		return;
	for (let plan of this.plans) {
		if (newPlan.category === "unit" && plan.type === newPlan.type && plan.number + newPlan.number <= plan.maxMerge) {
			plan.addItem(newPlan.number);
			return;
		} else if (newPlan.category === "technology" && plan.type === newPlan.type)
			return;
	}
	this.plans.push(newPlan);
};

ARCH.Queue.prototype.check = function (gameState) {
	while (this.plans.length > 0) {
		if (!this.plans[0].isInvalid(gameState)) {
			return;
		}

		let plan = this.plans.shift();
		if (plan.queueToReset)
			gameState.ai.queueManager.changePriority(plan.queueToReset, gameState.ai.Config.priorities[plan.queueToReset]);
	}
};

ARCH.Queue.prototype.getNext = function () {
	if (this.plans.length > 0)
		return this.plans[0];
	return null;
};

ARCH.Queue.prototype.startNext = function (gameState) {
	if (this.plans.length > 0) {
		this.plans.shift().start(gameState);
		return true;
	}
	return false;
};

/**
 * returns the maximal account we'll accept for this queue.
 * Currently all the cost of the first element and fraction of that of the second
 */
ARCH.Queue.prototype.maxAccountWanted = function (gameState, fraction) {
	let cost = new API3.Resources();
	if (this.plans.length > 0)
		cost.add(this.plans[0].getCost());
	if (this.plans.length > 1 && fraction > 0) {
		let costs = this.plans[1].getCost();
		costs.multiply(fraction);
		cost.add(costs);
	}
	return cost;
};

ARCH.Queue.prototype.queueCost = function () {
	let cost = new API3.Resources();
	for (let plan of this.plans)
		cost.add(plan.getCost());
	return cost;
};

ARCH.Queue.prototype.length = function () {
	return this.plans.length;
};

ARCH.Queue.prototype.hasQueuedUnits = function () {
	return this.plans.length > 0;
};

ARCH.Queue.prototype.countQueuedUnits = function () {
	let count = 0;
	for (let plan of this.plans)
		count += plan.number;
	return count;
};

ARCH.Queue.prototype.hasQueuedUnitsWithClass = function (classe) {
	return this.plans.some(plan => plan.template && plan.template.hasClass(classe));
};

ARCH.Queue.prototype.countQueuedUnitsWithClass = function (classe) {
	let count = 0;
	for (let plan of this.plans)
		if (plan.template && plan.template.hasClass(classe))
			count += plan.number;
	return count;
};

ARCH.Queue.prototype.countQueuedUnitsWithMetadata = function (data, value) {
	let count = 0;
	for (let plan of this.plans)
		if (plan.metadata[data] && plan.metadata[data] === value)
			count += plan.number;
	return count;
};

///
ARCH.Queue.prototype.Serialize = function () {
	let plans = [];
	for (let plan of this.plans)
		plans.push(plan.Serialize());

	return {"plans": plans, "paused": this.paused, "switched": this.switched};
};

ARCH.Queue.prototype.Deserialize = function (gameState, data) {
	this.paused = data.paused;
	this.switched = data.switched;
	this.plans = [];
	for (let dataPlan of data.plans) {
		let plan;
		if (dataPlan.category === "unit")
			plan = new ARCH.TrainingPlan(gameState, dataPlan.type);
		else if (dataPlan.category === "building")
			plan = new ARCH.ConstructionPlan(gameState, "Deserialize", dataPlan.type);
		else if (dataPlan.category === "technology")
			plan = new ARCH.ResearchPlan(gameState, dataPlan.type);
		else {
			gameState.ai.logger.push("ERROR", "QUEUE", "Unknown plan: " + uneval(dataPlan));
			continue;
		}
		plan.Deserialize(gameState, dataPlan);
		this.plans.push(plan);
	}
};
///
