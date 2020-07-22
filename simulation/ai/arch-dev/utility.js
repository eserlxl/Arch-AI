ARCH.checkPhase = function (gameState, phase) {
	return (gameState.currentPhase() >= phase) || gameState.isResearching(gameState.getPhaseName(phase));
};

ARCH.hash = function (str, maxLen = 1e4) {
	let h = 0, len = Math.min(maxLen, str.length);
	for (let i = 0; i < len; i++) {
		h = Math.imul(31, h) + str.charCodeAt(i) | 0;
	}
	h = Math.abs(h);
	return "H" + str.charCodeAt(h % len) + h;
};

ARCH.modCheck = function (x, mod = 1, remainder = 0) {
	mod = Math.floor(mod);
	if (mod < 2) {
		return true;
	} else {
		x = Math.floor(x);
		remainder = Math.floor(remainder);
		return x % mod === remainder;
	}
};

ARCH.limit = function (x, lowerBound, upperBound) {
	// Protection for misuse
	let low = Math.min(lowerBound, upperBound);
	let high = Math.max(lowerBound, upperBound);

	if (x < low) {
		return low;
	} else if (x > high) {
		return high;
	}
	return x;
};

ARCH.interpolate = function (x, x1, y1, x2, y2) {
	if (x1 === x2)
		return x1;

	let m = (y2 - y1) / (x2 - x1);
	let n = y1 - m * x1;
	return m * x + n;
};