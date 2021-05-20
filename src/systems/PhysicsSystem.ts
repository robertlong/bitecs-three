import * as Rapier from "@dimforge/rapier3d-compat";
import { Vector2, Vector3, Mesh, Quaternion, Euler, ArrowHelper } from "three";
import { Object3DComponent } from "../components";
import {
  System,
  defineSystem,
  World,
  defineMapComponent,
  defineQuery,
  enterQuery,
  singletonQuery,
  addMapComponent,
} from "../core/ECS";
import { ButtonActionState } from "./ActionMappingSystem";
import { sceneQuery } from "./RendererSystem";

interface PhysicsWorldProps {
  gravity?: Vector3;
  updateGravity?: boolean;
  debug?: boolean;
}

export const PhysicsWorldComponent = defineMapComponent<PhysicsWorldProps>();

export const PhysicsBodyStatus = Rapier.BodyStatus;

export enum PhysicsColliderShape {
  Box = "Box",
  Sphere = "Sphere",
  Capsule = "Capsule",
}

interface PhysicsRigidBodyProps {
  translation?: Vector3;
  rotation?: Euler;
  shape?: PhysicsColliderShape;
  bodyStatus?: Rapier.BodyStatus;
}

interface CapsuleRigidBodyProps extends PhysicsRigidBodyProps {
  shape: PhysicsColliderShape.Capsule;
  halfHeight: number;
  radius: number;
}

export const PhysicsRigidBodyComponent =
  defineMapComponent<CapsuleRigidBodyProps | PhysicsRigidBodyProps>();

const physicsWorldQuery = defineQuery([PhysicsWorldComponent]);
const newPhysicsWorldsQuery = enterQuery(physicsWorldQuery);

const rigidBodiesQuery = defineQuery([
  PhysicsRigidBodyComponent,
  Object3DComponent,
]);
const newRigidBodiesQuery = enterQuery(rigidBodiesQuery);

interface RapierPhysicsWorldProps {
  physicsWorld?: Rapier.World;
  eventQueue?: Rapier.EventQueue;
  colliderHandleToEntityMap?: Map<number, number>;
}

const RapierPhysicsWorldComponent =
  defineMapComponent<RapierPhysicsWorldProps>();
interface RapierPhysicsRigidBodyProps {
  body?: Rapier.RigidBody;
}

const RapierPhysicsRigidBodyComponent =
  defineMapComponent<RapierPhysicsRigidBodyProps>();

interface PhysicsRaycasterProps {
  useObject3DTransform?: boolean;
  transformNeedsUpdate?: boolean;
  transformAutoUpdate?: boolean;
  withIntersection?: boolean;
  withNormal?: boolean;
  origin?: Vector3;
  dir?: Vector3;
  colliderEid?: number;
  toi?: number;
  intersection?: Vector3;
  normal?: Vector3;
  maxToi?: number;
  debug?: boolean;
}

export const PhysicsRaycasterComponent =
  defineMapComponent<PhysicsRaycasterProps>();

const physicsRaycasterQuery = defineQuery([PhysicsRaycasterComponent]);
const newPhysicsRaycastersQuery = enterQuery(physicsRaycasterQuery);
const mainSceneQuery = singletonQuery(sceneQuery);

interface RapierRaycasterProps {
  ray?: Rapier.Ray;
  arrowHelper?: ArrowHelper;
}

const RapierRaycasterComponent = defineMapComponent<RapierRaycasterProps>();

export async function loadRapierPhysicsSystem(): Promise<System> {
  await Rapier.init();

  const tempVec3 = new Vector3();
  const tempQuat = new Quaternion();

  return defineSystem(function RapierPhysicsSystem(world: World) {
    const physicsWorldEntities = physicsWorldQuery(world);
    const newPhysicsWorldEntities = newPhysicsWorldsQuery(world);
    const rigidBodyEntities = rigidBodiesQuery(world);
    const newRigidBodyEntities = newRigidBodiesQuery(world);
    const physicsRaycasterEntities = physicsRaycasterQuery(world);
    const newPhysicsRaycasterEntities = newPhysicsRaycastersQuery(world);
    const sceneEid = mainSceneQuery(world);

    newPhysicsWorldEntities.forEach((eid) => {
      const physicsWorldComponent = PhysicsWorldComponent.storage.get(eid)!;
      RapierPhysicsWorldComponent.storage.get(eid)!;

      const gravityConfig = physicsWorldComponent.gravity;
      const physicsWorld = new Rapier.World(
        gravityConfig || new Vector3(0, -9.8)
      );

      const eventQueue = new Rapier.EventQueue(true);

      addMapComponent(world, RapierPhysicsWorldComponent, eid, {
        physicsWorld,
        eventQueue,
        colliderHandleToEntityMap: new Map(),
      });
    });

    physicsWorldEntities.forEach((physicsWorldEid) => {
      const physicsWorldComponent =
        PhysicsWorldComponent.storage.get(physicsWorldEid)!;
      const rapierPhysicsWorldComponent =
        RapierPhysicsWorldComponent.storage.get(physicsWorldEid)!;

      const { gravity, updateGravity } = physicsWorldComponent;
      const { physicsWorld, eventQueue, colliderHandleToEntityMap } =
        rapierPhysicsWorldComponent;

      newRigidBodyEntities.forEach((rigidBodyEid) => {
        const obj = Object3DComponent.storage.get(rigidBodyEid)!;
        const { bodyStatus, shape, translation, rotation, ...rigidBodyProps } =
          PhysicsRigidBodyComponent.storage.get(rigidBodyEid)!;

        const geometry = (obj as Mesh).geometry;

        if (!geometry && !shape) {
          return;
        }

        obj.getWorldPosition(tempVec3);
        obj.getWorldQuaternion(tempQuat);

        const rigidBodyDesc = new Rapier.RigidBodyDesc(
          bodyStatus !== undefined ? bodyStatus : PhysicsBodyStatus.Static
        );

        rigidBodyDesc.setRotation(
          new Rapier.Quaternion(tempQuat.x, tempQuat.y, tempQuat.z, tempQuat.w)
        );
        rigidBodyDesc.setTranslation(tempVec3.x, tempVec3.y, tempVec3.z);

        const body = physicsWorld!.createRigidBody(rigidBodyDesc);

        let colliderDesc: Rapier.ColliderDesc;

        const geometryType = geometry && geometry.type;

        if (geometryType === "BoxGeometry") {
          geometry.computeBoundingBox();
          const boundingBoxSize = geometry.boundingBox!.getSize(new Vector3());
          colliderDesc = Rapier.ColliderDesc.cuboid(
            boundingBoxSize.x / 2,
            boundingBoxSize.y / 2,
            boundingBoxSize.z / 2
          );
        } else if (geometryType === "SphereGeometry") {
          geometry.computeBoundingSphere();
          const radius = geometry.boundingSphere!.radius;
          colliderDesc = Rapier.ColliderDesc.ball(radius);
        } else if (shape === PhysicsColliderShape.Capsule) {
          const { radius, halfHeight } =
            rigidBodyProps as CapsuleRigidBodyProps;
          colliderDesc = Rapier.ColliderDesc.capsule(halfHeight, radius);
        } else {
          throw new Error("Unimplemented");
        }

        if (translation) {
          colliderDesc.setTranslation(
            translation.x,
            translation.y,
            translation.z
          );
        }

        if (rotation) {
          tempQuat.setFromEuler(rotation);
          colliderDesc.setRotation(
            new Rapier.Quaternion(
              tempQuat.x,
              tempQuat.y,
              tempQuat.z,
              tempQuat.w
            )
          );
        }

        // TODO: Handle mass / density
        // TODO: Handle scale
        // TODO: Handle dynamic gravity

        const collider = physicsWorld!.createCollider(
          colliderDesc,
          body.handle
        );

        colliderHandleToEntityMap!.set(collider.handle, rigidBodyEid);

        addMapComponent(world, RapierPhysicsRigidBodyComponent, rigidBodyEid, {
          body,
        });
      });

      newPhysicsRaycasterEntities.forEach((raycasterEid) => {
        const raycaster = PhysicsRaycasterComponent.storage.get(raycasterEid)!;

        raycaster.intersection = new Vector3();

        if (raycaster.useObject3DTransform === undefined) {
          raycaster.useObject3DTransform = true;
        }

        if (raycaster.withIntersection === undefined) {
          raycaster.withIntersection = false;
        }

        if (raycaster.withNormal === undefined) {
          raycaster.withNormal = false;
        }

        if (!raycaster.origin) {
          raycaster.origin = new Vector3(0, 0, 0);
        }

        if (!raycaster.dir) {
          raycaster.dir = new Vector3(0, 0, -1);
        }

        if (
          raycaster.useObject3DTransform &&
          raycaster.transformAutoUpdate === undefined
        ) {
          raycaster.transformAutoUpdate = true;
          raycaster.transformNeedsUpdate = true;
        } else if (raycaster.transformNeedsUpdate === undefined) {
          raycaster.transformNeedsUpdate = true;
        }

        if (raycaster.maxToi === undefined) {
          raycaster.maxToi = Number.MAX_VALUE;
        }

        RapierRaycasterComponent.storage.set(raycasterEid, {
          ray: new Rapier.Ray(raycaster.origin, raycaster.dir),
        });
      });

      if (gravity && updateGravity) {
        physicsWorld!.gravity.x = gravity!.x;
        physicsWorld!.gravity.y = gravity!.y;
        physicsWorld!.gravity.z = gravity!.z;
        physicsWorldComponent.updateGravity = false;
      }

      physicsWorld!.step(eventQueue);

      eventQueue!.drainContactEvents((handle1, handle2, contactStarted) => {
        const collider1 = physicsWorld!.getCollider(handle1);
        const collider2 = physicsWorld!.getCollider(handle2);

        // console.log(
        //   "Contact between:",
        //   collider1,
        //   "and",
        //   collider2,
        //   ". Started:",
        //   contactStarted
        // );
      });

      eventQueue!.drainIntersectionEvents((handle1, handle2, intersecting) => {
        const collider1 = physicsWorld!.getCollider(handle1);
        const collider2 = physicsWorld!.getCollider(handle2);

        // console.log(
        //   "Intersection between: ",
        //   collider1,
        //   "and",
        //   collider2,
        //   ". Currently intersecting:",
        //   intersecting
        // );
      });

      physicsRaycasterEntities.forEach((rayCasterEid) => {
        const raycaster = PhysicsRaycasterComponent.storage.get(rayCasterEid)!;
        const obj = Object3DComponent.storage.get(rayCasterEid);

        if (
          raycaster.useObject3DTransform &&
          obj &&
          (raycaster.transformNeedsUpdate || raycaster.transformAutoUpdate)
        ) {
          obj.getWorldPosition(raycaster.origin!);
          obj.getWorldDirection(raycaster.dir!);

          if (!raycaster.transformAutoUpdate) {
            raycaster.transformNeedsUpdate = false;
          }
        }

        const internalRaycaster =
          RapierRaycasterComponent.storage.get(rayCasterEid)!;

        let intersection;

        if (raycaster.withNormal) {
          intersection = physicsWorld!.castRayAndGetNormal(
            internalRaycaster.ray!,
            raycaster.maxToi!
          );

          if (intersection) {
            raycaster.normal!.copy(intersection.normal as Vector3);
          } else {
            raycaster.normal!.set(0, 0, 0);
          }
        } else {
          intersection = physicsWorld!.castRay(
            internalRaycaster.ray!,
            raycaster.maxToi!
          );
        }

        if (intersection) {
          raycaster.colliderEid = colliderHandleToEntityMap!.get(
            intersection.colliderHandle
          );
          raycaster.toi = intersection.toi;
        } else {
          raycaster.colliderEid = undefined;
          raycaster.toi = undefined;
        }

        if (raycaster.withIntersection) {
          if (raycaster.colliderEid !== undefined) {
            raycaster
              .intersection!.addVectors(raycaster.origin!, raycaster.dir!)
              .multiplyScalar(raycaster.toi!);
          } else {
            raycaster.intersection!.set(0, 0, 0);
          }
        }

        if (raycaster.debug) {
          if (!internalRaycaster.arrowHelper) {
            internalRaycaster.arrowHelper = new ArrowHelper(
              raycaster.dir,
              raycaster.origin,
              raycaster.toi,
              0xffff00,
              0.2,
              0.1
            );
            const scene = Object3DComponent.storage.get(sceneEid!)!;
            scene.add(internalRaycaster.arrowHelper);
          } else {
            const arrowHelper = internalRaycaster.arrowHelper;
            arrowHelper.position.copy(raycaster.origin!);
            arrowHelper.setDirection(raycaster.dir!);
            arrowHelper.setLength(raycaster.toi!, 0.2, 0.1);
          }
        } else if (!raycaster.debug && internalRaycaster.arrowHelper) {
          const scene = Object3DComponent.storage.get(sceneEid!)!;
          scene.remove(internalRaycaster.arrowHelper);
          internalRaycaster.arrowHelper = undefined;
        }
      });

      rigidBodyEntities.forEach((rigidBodyEid) => {
        const obj = Object3DComponent.storage.get(rigidBodyEid)!;
        const { body } =
          RapierPhysicsRigidBodyComponent.storage.get(rigidBodyEid)!;

        if (body!.isDynamic() || body!.isKinematic()) {
          const translation = body!.translation();
          const rotation = body!.rotation();
          obj.position.set(translation.x, translation.y, translation.z);
          obj.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        }
      });
    });
  });
}

export const PhysicsCharacterControllerActions = {
  Move: "PhysicsCharacterController/Move",
  Jump: "PhysicsCharacterController.Jump",
};

interface PhysicsCharacterControllerProps {
  speed?: number;
}

export const PhysicsCharacterControllerComponent =
  defineMapComponent<PhysicsCharacterControllerProps>();

interface KinematicRigidBodyState {
  velocity?: Vector3;
}

export const KinematicRigidBodyStateComponent =
  defineMapComponent<KinematicRigidBodyState>();

const physicsCharacterControllerQuery = defineQuery([
  PhysicsCharacterControllerComponent,
  RapierPhysicsRigidBodyComponent,
]);

const physicsCharacterControllerAddedQuery = enterQuery(
  physicsCharacterControllerQuery
);

export const PhysicsCharacterControllerSystem = defineSystem(
  function PhysicsCharacterControllerSystem(world: World) {
    const physicsWorldEntities = physicsWorldQuery(world);
    const entities = physicsCharacterControllerQuery(world);
    const addedEntities = physicsCharacterControllerAddedQuery(world);

    addedEntities.forEach((eid) => {
      addMapComponent(world, KinematicRigidBodyStateComponent, eid, {
        velocity: new Vector3(),
      });
    });

    physicsWorldEntities.forEach((worldEid) => {
      entities.forEach((eid) => {
        const moveVec = world.actions.get(
          PhysicsCharacterControllerActions.Move
        ) as Vector2;

        const jump = world.actions.get(
          PhysicsCharacterControllerActions.Jump
        ) as ButtonActionState;

        const dt = world.dt;
        const { speed } = PhysicsCharacterControllerComponent.storage.get(eid)!;
        const { body } = RapierPhysicsRigidBodyComponent.storage.get(eid)!;
        const { velocity } = KinematicRigidBodyStateComponent.storage.get(eid)!;

        const translation = body!.translation();

        const _speed = speed === undefined ? 1 : speed;

        velocity!.z = -moveVec.y * _speed;
        velocity!.x = moveVec.x * _speed;

        if (jump.pressed) {
          velocity!.y = 1.5;
        }

        const isGrounded = true;

        if (isGrounded) {
          velocity!.y = 0;
        } else {
          velocity!.y += 9.8 * dt;
        }

        translation.x += velocity!.x * dt;
        translation.y += velocity!.y * dt;
        translation.z += velocity!.z * dt;

        body!.setNextKinematicTranslation(translation);
      });
    });
  }
);
