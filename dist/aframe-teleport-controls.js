/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ (function(module, exports, __webpack_require__) {

	/* global THREE, AFRAME, Element  */
	var cylinderTexture = __webpack_require__(1);
	var RayCurve = __webpack_require__(2);
	var parabolicCurve = __webpack_require__(3);
	function easeIn(t){
	  return t*t;
	}

	function easeOutIn(t){
	  if (t < 0.5) return 0.5 * ( (t=t*2-1) * t * t + 1);
	  return 0.5*(t = t*2-1)*t*t + 0.5;
	}

	/**
	 * Check for the raycaster intersection
	 * based on whether the mesh collides with the raycaster
	 * @returns {boolean} true, if there's an intersection
	 */

	function isValidNormalsAngle(collisionNormal, referenceNormal, landingMaxAngle) {
	  var angleNormals = referenceNormal.angleTo(collisionNormal);
	  return (THREE.Math.RAD2DEG * angleNormals <= landingMaxAngle);
	}

	if (typeof AFRAME === 'undefined') {
	  throw new Error('Component attempted to register before AFRAME was available.');
	}

	if (!Element.prototype.matches) {
	  Element.prototype.matches =
	    Element.prototype.matchesSelector ||
	    Element.prototype.mozMatchesSelector ||
	    Element.prototype.msMatchesSelector ||
	    Element.prototype.oMatchesSelector ||
	    Element.prototype.webkitMatchesSelector ||
	    function (s) {
	      var matches = (this.document || this.ownerDocument).querySelectorAll(s);
	      var i = matches.length;
	      while (--i >= 0 && matches.item(i) !== this) { /* no-op */ }
	      return i > -1;
	    };
	}

	AFRAME.registerComponent('teleport-controls', {
	  schema: {
	    type: {default: 'parabolic', oneOf: ['parabolic', 'line']},
	    button: {default: 'trackpad', oneOf: ['trackpad', 'trigger', 'grip', 'menu']},
	    startEvents: {type: 'array'},
	    endEvents: {type: 'array'},
	    collisionEntities: {default: ''},
	    hitEntity: {type: 'selector'},
	    cameraRig: {type: 'selector'},
	    teleportOrigin: {type: 'selector'},
	    hitCylinderColor: {type: 'color', default: '#99ff99'},
	    hitCylinderRadius: {default: 0.25, min: 0},
	    outerRadius: {default: 0.6, min: 0},
	    hitCylinderHeight: {default: 0.3, min: 0},
	    hitOuterTorusScale: {default: 2.5, min: 0.25},
	    interval: {default: 0},
	    maxLength: {default: 10, min: 0, if: {type: ['line']}},
	    curveNumberPoints: {default: 30, min: 2, if: {type: ['parabolic']}},
	    curveLineWidth: {default: 0.025},
	    curveHitColor: {type: 'color', default: '#99ff99'},
	    curveMissColor: {type: 'color', default: '#ff0000'},
	    curveShootingSpeed: {default: 5, min: 0, if: {type: ['parabolic']}},
	    defaultPlaneSize: { default: 100 },
	    landingNormal: {type: 'vec3', default: { x: 0, y: 1, z: 0 }},
	    landingMaxAngle: {default: '45', min: 0, max: 360},
	    drawIncrementally: {default: false},
	    incrementalDrawMs: {default: 700},
	    missOpacity: {default: 0.1},
	    hitOpacity: {default: 0.3}
	  },

	  checkLineIntersection: (function(){
	    const direction = new THREE.Vector3();
	    return function checkLineIntersection(start, end, meshes, raycaster, referenceNormal, landingMaxAngle, hitPoint) {
	      direction.copy(end).sub(start);
	      const distance = direction.length();
	      raycaster.far = distance;
	      raycaster.set(start, direction.normalize());
	      var intersects = raycaster.intersectObjects(meshes, true);
	      if (intersects.length > 0 && isValidNormalsAngle(intersects[0].face.normal, referenceNormal, landingMaxAngle)) {
	        hitPoint.copy(intersects[0].point);
	        return true;
	      }
	      return false;
	    };
	  })(),

	  init: function () {
	    var data = this.data;
	    var el = this.el;
	    var teleportEntity;
	    var i;
	    this.active = false;
	    this.obj = el.object3D;
	    this.hitPoint = new THREE.Vector3();
	    this.rigWorldPosition = new THREE.Vector3();
	    this.newRigWorldPosition = new THREE.Vector3();
	    this.teleportEventDetail = {
	      oldPosition: this.rigWorldPosition,
	      newPosition: this.newRigWorldPosition,
	      hitPoint: this.hitPoint
	    };

	    this.hit = false;
	    this.prevCheckTime = undefined;
	    this.prevHitHeight = 0;
	    this.prevCheckTime = 0;
	    this.currentCollidedIndex = 0;
	    this.referenceNormal = new THREE.Vector3();
	    this.curveMissColor = new THREE.Color();
	    this.curveHitColor = new THREE.Color();
	    this.raycaster = new THREE.Raycaster();

	    this.parabola = Array.from(new Array(data.curveNumberPoints), () => new THREE.Vector3());
	    this.defaultPlane = createDefaultPlane(this.data.defaultPlaneSize);
	    this.defaultCollisionMeshes = [this.defaultPlane];

	    teleportEntity = this.teleportEntity = document.createElement('a-entity');
	    teleportEntity.classList.add('teleportRay');
	    teleportEntity.setAttribute('visible', false);
	    el.sceneEl.appendChild(this.teleportEntity);

	    this.onButtonDown = this.onButtonDown.bind(this);
	    this.onButtonUp = this.onButtonUp.bind(this);
	    if (this.data.startEvents.length && this.data.endEvents.length) {

	      for (i = 0; i < this.data.startEvents.length; i++) {
	        el.addEventListener(this.data.startEvents[i], this.onButtonDown);
	      }
	      for (i = 0; i < this.data.endEvents.length; i++) {
	        el.addEventListener(this.data.endEvents[i], this.onButtonUp);
	      }
	    } else {
	      el.addEventListener(data.button + 'down', this.onButtonDown);
	      el.addEventListener(data.button + 'up', this.onButtonUp);
	    }

	    this.queryCollisionEntities();
	  },

	  update: function (oldData) {
	    var data = this.data;
	    var diff = AFRAME.utils.diff(data, oldData);

	    // Update normal.
	    this.referenceNormal.copy(data.landingNormal);

	    // Update colors.
	    this.curveMissColor.set(data.curveMissColor);
	    this.curveHitColor.set(data.curveHitColor);


	    // Create or update line mesh.
	    if (!this.line ||
	        'curveLineWidth' in diff || 'curveNumberPoints' in diff || 'type' in diff) {

	      this.line = createLine(data);
	      this.line.material.opacity = this.data.hitOpacity;
	      this.line.material.transparent = this.data.hitOpacity < 1;
	      this.timeSinceDrawStart = 0;
	      this.teleportEntity.setObject3D('mesh', this.line.mesh);
	    }

	    // Create or update hit entity.
	    if (data.hitEntity) {
	      this.hitEntity = data.hitEntity;
	    } else if (!this.hitEntity || 'hitCylinderColor' in diff || 'hitCylinderHeight' in diff ||
	               'hitCylinderRadius' in diff || 'outerRadius' in diff) {
	      // Remove previous entity, create new entity (could be more performant).
	      if (this.hitEntity) { this.hitEntity.parentNode.removeChild(this.hitEntity); }
	      this.hitEntity = this.createHitEntity(data);
	      this.el.sceneEl.appendChild(this.hitEntity);
	    }
	    this.hitEntity.setAttribute('visible', false);

	    if ('collisionEntities' in diff) { this.queryCollisionEntities(); }
	    if ('curveNumberPoints' in diff) {
	      this.parabola = Array.from(new Array(data.curveNumberPoints), () => new THREE.Vector3());
	    }
	  },

	  remove: function () {
	    var el = this.el;
	    var hitEntity = this.hitEntity;
	    var teleportEntity = this.teleportEntity;

	    if (hitEntity) { hitEntity.parentNode.removeChild(hitEntity); }
	    if (teleportEntity) { teleportEntity.parentNode.removeChild(teleportEntity); }

	    el.sceneEl.removeEventListener('child-attached', this.childAttachHandler);
	    el.sceneEl.removeEventListener('child-detached', this.childDetachHandler);
	  },

	  tick: (function () {
	    var p0 = new THREE.Vector3();
	    var v0 = new THREE.Vector3();
	    var halfA = new THREE.Vector3(0, -9.8/2, 0);
	    var point = new THREE.Vector3();
	    var quaternion = new THREE.Quaternion();
	    var translation = new THREE.Vector3();
	    var scale = new THREE.Vector3();
	    var shootAngle = new THREE.Vector3();
	    var auxDirection = new THREE.Vector3();
	    var timeSinceDrawStart = 0;

	    return function (time, delta) {
	      if (!this.active) { return; }
	      if (this.data.drawIncrementally && this.redrawLine){
	        this.redrawLine = false;
	        timeSinceDrawStart = 0;
	      }
	      timeSinceDrawStart += delta;
	      this.timeSinceDrawStart = timeSinceDrawStart;
	      if (this.timeSinceDrawStart > this.data.incrementalDrawMs || !this.data.drawIncrementally) {
	        this.timeSinceDrawStart = this.data.incrementalDrawMs;
	      }
	      const percentToDraw = this.timeSinceDrawStart / this.data.incrementalDrawMs;
	      let isPrevCheckTimeOverInterval = (time - this.prevCheckTime) > this.data.interval;

	      var matrixWorld = this.obj.matrixWorld;
	      matrixWorld.decompose(translation, quaternion, scale);

	      var direction = shootAngle.set(0, 0, -1)
	        .applyQuaternion(quaternion).normalize();
	      this.line.setDirection(auxDirection.copy(direction));
	      this.obj.getWorldPosition(p0);

	      this.teleportEntity.setAttribute('visible', true);
	      const numPoints = this.parabola.length;

	      if (this.data.type === 'parabolic') {
	        // Only check for intersection if interval time has passed.
	        if (isPrevCheckTimeOverInterval) {
	          this.hit = false;
	          this.currentCollidedIndex = numPoints - 1;
	          v0.copy(direction).multiplyScalar(this.data.curveShootingSpeed);
	          const timeSegment = 1 / (numPoints-1);
	          this.parabola[0].copy(p0);

	          for (let i = 1; i < numPoints; i++) {
	            let t = i * timeSegment;
	            parabolicCurve(p0, v0, halfA, t, point);
	            this.parabola[i].copy(point);

	            if (this.checkLineIntersection(this.parabola[i-1], this.parabola[i], this.meshes, this.raycaster, this.referenceNormal, this.data.landingMaxAngle, this.hitPoint)) {
	              this.hit = true;
	              this.currentCollidedIndex = i;
	              break;
	            }
	          }
	          this.prevCheckTime = time;
	        }
	        /** percentRaycasted: the final parabolic curve we use, which might not be the whole parabolic line we calculate above.
	         * percentToDraw: it decides the porpotion of the line we are drawing out at this time frame.
	        */
	        const percentRaycasted = this.currentCollidedIndex / (numPoints-1);
	        const segmentT = percentToDraw*percentRaycasted / (numPoints-1);
	        for (let i = 0; i < numPoints; i++) {
	          const t = i*segmentT;
	          parabolicCurve(p0, v0, halfA, t, point);
	          this.line.setPoint(i, point);
	        }
	      } else if (this.data.type === 'line') {
	        this.raycaster.far = this.data.maxLength;
	        this.raycaster.set(p0, direction);
	        if (isPrevCheckTimeOverInterval) {
	          this.hit = false;
	          point.copy(p0).add(auxDirection.copy(direction).multiplyScalar(this.data.maxLength));
	          if (this.checkLineIntersection(p0, point, this.meshes, this.raycaster, this.referenceNormal, this.data.landingMaxAngle,  this.hitPoint)) {
	            this.currentCollidedIndex = 1;
	            this.hit = true;
	          }
	        }
	        this.line.setPoint(0, p0);
	        const distance = p0.distanceTo(this.hit? this.hitPoint : point);
	        point.copy(p0).add(auxDirection.copy(direction).multiplyScalar(percentToDraw * distance));
	        this.line.setPoint(1, point);
	      }

	      const color = this.hit ? this.curveHitColor : this.curveMissColor;
	      const opacity = this.hit && this.timeSinceDrawStart === this.data.incrementalDrawMs ? this.data.hitOpacity : this.data.missOpacity;
	      const transparent = opacity < 1;
	      this.line.material.color.set(color);
	      this.line.material.opacity = opacity;
	      this.line.material.transparent = transparent;
	      this.hitEntity.setAttribute('visible', this.hit);
	      if (this.hit) {
	        this.hitEntity.setAttribute('position', this.hitPoint);
	        const hitEntityOpacity = this.data.hitOpacity*easeOutIn(percentToDraw);
	        const dRadii = this.data.outerRadius - this.data.hitCylinderRadius;
	        const outerScale = (this.data.outerRadius - easeIn(percentToDraw)*dRadii) / this.data.outerRadius;
	        this.outerTorus.object3D.scale.set(outerScale, outerScale, 1);
	        this.torus.setAttribute('material', 'opacity', hitEntityOpacity);
	        this.cylinder.setAttribute('material', 'opacity', hitEntityOpacity);
	      }
	    };
	  })(),

	  /**
	   * Run `querySelectorAll` for `collisionEntities` and maintain it with `child-attached`
	   * and `child-detached` events.
	   */
	  queryCollisionEntities: function () {
	    var collisionEntities;
	    var meshes;
	    var defaultCollisionMeshes;
	    var data = this.data;
	    var el = this.el;

	    if (!data.collisionEntities) {
	      this.collisionEntities = [];
	      return;
	    }

	    collisionEntities = [].slice.call(el.sceneEl.querySelectorAll(data.collisionEntities));
	    this.collisionEntities = collisionEntities;
	    defaultCollisionMeshes = this.defaultCollisionMeshes;
	    if (!this.data.collisionEntities) {
	      meshes = this.defaultCollisionMeshes;
	    } else {
	      meshes = getMeshes(this.collisionEntities, defaultCollisionMeshes);
	    }
	    this.meshes = meshes;

	    if (this.childAttachHandler) {
	      el.sceneEl.removeEventListener('child-attached', this.childAttachHandler);
	    }
	    if (this.childDetachHandler) {
	      el.sceneEl.removeEventListener('child-detached', this.childDetachHandler);
	    }
	    // Update entity list on attach.
	    this.childAttachHandler = function childAttachHandler (evt) {
	      if (!evt.detail.el.matches(data.collisionEntities)) { return; }
	      collisionEntities.push(evt.detail.el);
	      meshes = getMeshes(collisionEntities, defaultCollisionMeshes);

	    };
	    el.sceneEl.addEventListener('child-attached', this.childAttachHandler);

	    // Update entity list on detach.
	    this.childDetachHandler = function childDetachHandler (evt) {
	      var index;
	      if (!evt.detail.el.matches(data.collisionEntities)) { return; }
	      index = collisionEntities.indexOf(evt.detail.el);
	      if (index === -1) { return; }
	      collisionEntities.splice(index, 1);
	      meshes = getMeshes(collisionEntities, defaultCollisionMeshes);
	    };
	    el.sceneEl.addEventListener('child-detached', this.childDetachHandler);
	  },

	  onButtonDown: function () {
	    this.active = true;
	    this.redrawLine = true;
	  },

	  /**
	   * Jump!
	   */
	  onButtonUp: (function () {
	    const teleportOriginWorldPosition = new THREE.Vector3();
	    const newRigLocalPosition = new THREE.Vector3();
	    const newHandPosition = [new THREE.Vector3(), new THREE.Vector3()]; // Left and right
	    const handPosition = new THREE.Vector3();

	    return function (evt) {
	      if (!this.active) { return; }

	      this.active = false;
	      this.hitEntity.setAttribute('visible', false);
	      this.teleportEntity.setAttribute('visible', false);

	      if (!this.hit) {
	        // Button released but not hit point
	        return;
	      }

	      // button released before the teleport animation finishes
	      if (this.hit && this.timeSinceDrawStart < this.data.incrementalDrawMs) { return; }

	      const rig = this.data.cameraRig || this.el.sceneEl.camera.el;
	      rig.object3D.getWorldPosition(this.rigWorldPosition);
	      this.newRigWorldPosition.copy(this.hitPoint);

	      // If a teleportOrigin exists, offset the rig such that the teleportOrigin is above the hitPoint
	      const teleportOrigin = this.data.teleportOrigin;
	      if (teleportOrigin) {
	        teleportOrigin.object3D.getWorldPosition(teleportOriginWorldPosition);
	        this.newRigWorldPosition.sub(teleportOriginWorldPosition).add(this.rigWorldPosition);
	      }

	      // Always keep the rig at the same offset off the ground after teleporting
	      this.newRigWorldPosition.y = this.rigWorldPosition.y + this.hitPoint.y - this.prevHitHeight;
	      this.prevHitHeight = this.hitPoint.y;

	      // Finally update the rigs position
	      newRigLocalPosition.copy(this.newRigWorldPosition);
	      if (rig.object3D.parent) {
	        rig.object3D.parent.worldToLocal(newRigLocalPosition);
	      }
	      rig.setAttribute('position', newRigLocalPosition);

	      // If a rig was not explicitly declared, look for hands and mvoe them proportionally as well
	      if (!this.data.cameraRig) {
	        var hands = document.querySelectorAll('a-entity[tracked-controls]');
	        for (var i = 0; i < hands.length; i++) {
	          hands[i].object3D.getWorldPosition(handPosition);

	          newHandPosition[i].copy(this.newRigWorldPosition).sub(this.rigWorldPosition).add(handPosition);
	          hands[i].setAttribute('position', newHandPosition[i]);
	        }
	      }

	      this.el.emit('teleported', this.teleportEventDetail);
	    };
	  })(),

	  /**
	   * Create mesh to represent the area of intersection.
	   * Default to a combination of torus and cylinder.
	   */
	  createHitEntity (data) {
	    var hitEntity;

	    // Parent.
	    hitEntity = document.createElement('a-entity');
	    hitEntity.className = 'hitEntity';

	    // Torus.
	    this.torus = document.createElement('a-entity');
	    this.torus.setAttribute('geometry', {
	      primitive: 'torus',
	      radius: data.hitCylinderRadius,
	      radiusTubular: 0.01,
	      segmentsRadial: 16,
	      segmentsTubular: 18
	    });
	    this.torus.setAttribute('rotation', {x: 90, y: 0, z: 0});
	    this.torus.setAttribute('material', {
	      shader: 'flat',
	      color: data.hitCylinderColor,
	      side: 'double',
	      depthTest: false
	    });
	    hitEntity.appendChild(this.torus);

	    // Cylinder.
	    this.cylinder = document.createElement('a-entity');
	    this.cylinder.setAttribute('position', {x: 0, y: data.hitCylinderHeight / 2, z: 0});
	    this.cylinder.setAttribute('geometry', {
	      primitive: 'cylinder',
	      segmentsHeight: 1,
	      radius: data.hitCylinderRadius,
	      height: data.hitCylinderHeight,
	      openEnded: true
	    });
	    this.cylinder.setAttribute('material', {
	      shader: 'flat',
	      color: data.hitCylinderColor,
	      side: 'double',
	      src: cylinderTexture,
	      transparent: true,
	      depthTest: false
	    });
	    hitEntity.appendChild(this.cylinder);

	    // create another torus for animating when the hit destination is ready to go
	    this.outerTorus = document.createElement('a-entity');
	    this.outerTorus.setAttribute('geometry', {
	      primitive: 'torus',
	      radius: data.outerRadius,
	      radiusTubular: 0.01,
	      segmentsRadial: 16,
	      segmentsTubular: 18
	    });
	    this.outerTorus.setAttribute('rotation', {x: 90, y: 0, z: 0});
	    this.outerTorus.setAttribute('material', {
	      shader: 'flat',
	      color: data.hitCylinderColor,
	      side: 'double',
	      opacity: data.hitOpacity,
	      depthTest: false
	    });
	    this.outerTorus.setAttribute('id', 'outerTorus');
	    hitEntity.appendChild(this.outerTorus);

	    return hitEntity;
	  }
	});

	function getMeshes (collisionEntities, defaultCollisionMeshes) {
	  var meshes = collisionEntities.map(function (entity) {
	    return entity.getObject3D('mesh');
	  }).filter(function (n) { return n; });
	  meshes = meshes.length ? meshes : defaultCollisionMeshes;
	  return meshes;
	}

	function createLine (data) {
	  var numPoints = data.type === 'line' ? 2 : data.curveNumberPoints;
	  return new RayCurve(numPoints, data.curveLineWidth);
	}


	function createDefaultPlane (size) {
	  var geometry;
	  var material;

	  geometry = new THREE.PlaneBufferGeometry(100, 100);
	  geometry.rotateX(-Math.PI / 2);
	  material = new THREE.MeshBasicMaterial({color: 0xffff00});
	  return new THREE.Mesh(geometry, material);
	}


/***/ }),
/* 1 */
/***/ (function(module, exports) {

	module.exports = 'url(data:image/png;base64,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)';


/***/ }),
/* 2 */
/***/ (function(module, exports) {

	/* global THREE */
	var RayCurve = function (numPoints, width) {
	  this.geometry = new THREE.BufferGeometry();
	  this.vertices = new Float32Array(numPoints * 3 * 2);
	  this.uvs = new Float32Array(numPoints * 2 * 2);
	  this.width = width;

	  this.geometry.addAttribute('position', new THREE.BufferAttribute(this.vertices, 3).setDynamic(true));

	  this.material = new THREE.MeshBasicMaterial({
	    side: THREE.DoubleSide,
	    color: 0xff0000
	  });

	  this.mesh = new THREE.Mesh(this.geometry, this.material);
	  this.mesh.drawMode = THREE.TriangleStripDrawMode;

	  this.mesh.frustumCulled = false;
	  this.mesh.vertices = this.vertices;

	  this.direction = new THREE.Vector3();
	  this.numPoints = numPoints;
	};

	RayCurve.prototype = {
	  setDirection: function (direction) {
	    var UP = new THREE.Vector3(0, 1, 0);
	    this.direction
	      .copy(direction)
	      .cross(UP)
	      .normalize()
	      .multiplyScalar(this.width / 2);
	  },

	  setWidth: function (width) {
	    this.width = width;
	  },

	  setPoint: (function () {
	    var posA = new THREE.Vector3();
	    var posB = new THREE.Vector3();

	    return function (i, point) {
	      posA.copy(point).add(this.direction);
	      posB.copy(point).sub(this.direction);

	      var idx = 2 * 3 * i;
	      this.vertices[idx++] = posA.x;
	      this.vertices[idx++] = posA.y;
	      this.vertices[idx++] = posA.z;

	      this.vertices[idx++] = posB.x;
	      this.vertices[idx++] = posB.y;
	      this.vertices[idx++] = posB.z;

	      this.geometry.attributes.position.needsUpdate = true;
	    };
	  })()
	};

	module.exports = RayCurve;


/***/ }),
/* 3 */
/***/ (function(module, exports) {

	/* global THREE */
	// Parabolic motion equation, y = p0 + v0*t + 1/2at^2
	function parabolicCurveScalar(p0, v0, halfA, t, tSquared) {
	  return p0 + v0 * t + halfA * tSquared;
	}

	// Parabolic motion equation applied to 3 dimensions
	function parabolicCurve(p0, v0, halfA, t, out) {
	  const tSquared = t * t;
	  out.x = parabolicCurveScalar(p0.x, v0.x, halfA.x, t, tSquared);
	  out.y = parabolicCurveScalar(p0.y, v0.y, halfA.y, t, tSquared);
	  out.z = parabolicCurveScalar(p0.z, v0.z, halfA.z, t, tSquared);
	  return out;
	}

	module.exports = parabolicCurve;


/***/ })
/******/ ]);