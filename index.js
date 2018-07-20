/* global THREE, AFRAME, Element  */
var cylinderTexture = require('./lib/cylinderTexture');
var RayCurve = require('./lib/RayCurve');
var parabolicCurve = require("./lib/ParabolicCurve");
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
      radiusTubular: 0.01
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
      radiusTubular: 0.01
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
