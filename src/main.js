import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/examples/jsm/animation/MMDAnimationHelper.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GUI } from 'lil-gui';

// ============================================
// 全局变量
// ============================================
let scene, camera, renderer, controls;
let composer, bloomPass, colorGradingPass;
let helper, loader;
let audio = null;
let isPlaying = false;
let animationDuration = 0;
let animClock = new THREE.Clock(false);
let mesh = null;           // PMX 模型
let backWall = null;       // 白色墙壁
let ground = null;         // 地面
let vmdClip = null;        // VMD 动作数据（重置时需要）

// 文件上传选择
let selectedModelFiles = null; // FileList
let selectedMotionFile = null; // File
let selectedAudioFile = null;  // File
let selectedExpressionFile = null; // 表情动作 VMD 文件
let selectedCameraFile = null; // 镜头动作 VMD 文件
let selectedPmxPath = null;    // 选中的 PMX 路径（多 PMX 时）

// 时间轴状态
let isSeeking = false;
let autoStopped = false; // 动画结束后自动停止，防止重复触发

// 灯光对象（全局以便 GUI 调节）
let lights = {};

// 动画循环
let animationId;

// 材质集合
let skinMaterials = [];    // 皮肤材质集合

// 文件路径映射（拖拽上传时使用，因为 File.webkitRelativePath 是只读的）
const filePathMap = new WeakMap();

const loadingEl = document.getElementById('loading');
const loadingText = document.getElementById('loading-text');
const progressFill = document.getElementById('progress-fill');
const timeDisplay = document.getElementById('time-display');
const fpsDisplay = document.getElementById('fps-display');

// ============================================
// 预设系统
// ============================================
const CONFIG_KEY = 'mmd-renderer-config-v2';

const PRESETS = {
  'MMD式渲染': {
    sun: {
      enabled: true,
      color: '#ffffff',
      intensity: 0.725,
      posX: 9.9,
      posY: 14.44,
      posZ: 15.24,
      castShadow: true,
      shadowBias: -0.00278,
      shadowSize: 2560,
    },
    ambient: { color: '#fffafa', intensity: 1 },
    fill: { color: '#cce0ff', intensity: 0.594 },
    rim: { color: '#ffddcc', intensity: 0.646 },
    hemi: { skyColor: '#eef4ff', groundColor: '#443333', intensity: 0.976 },
    wall: {
      visible: false,
      color: '#ffffff',
      posZ: -5.49,
      scale: 3,
      receiveShadow: true,
    },
    background: {
      color: '#5f7c9b',
      fogColor: '#424266',
      fogNear: 100,
      fogFar: 300,
    },
    bloom: {
      strength: 0.316,
      radius: 1.38,
      threshold: 0.754,
    },
    colorGrading: {
      saturation: 1.18,
      contrast: 1.1,
      brightness: 0.05,
      temperature: 0,
      gamma: 1.21,
    },
    skin: {
      shininess: 39.9,
      reflectivity: 0.589,
    },
    exposure: 0.7061,
  },
};

let presets = deepClone(PRESETS);
let currentPresetName = 'MMD式渲染';
let config = deepClone(PRESETS['MMD式渲染']);

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // 新格式：包含 currentPresetName + presets
      if (saved.currentPresetName && saved.presets) {
        currentPresetName = saved.currentPresetName;
        presets = deepMergePresets(deepClone(PRESETS), saved.presets);
        config = deepClone(presets[currentPresetName] || PRESETS['MMD式渲染']);
        return;
      }
      // 旧格式迁移（v1 直接是配置对象）
      const migrated = deepMerge(deepClone(PRESETS['MMD式渲染']), saved);
      presets['MMD式渲染'] = migrated;
      config = deepClone(migrated);
      currentPresetName = 'MMD式渲染';
      return;
    }
  } catch (e) {
    console.warn('配置读取失败', e);
  }
  config = deepClone(PRESETS['MMD式渲染']);
  presets = deepClone(PRESETS);
  currentPresetName = 'MMD式渲染';
}

function saveConfig() {
  try {
    presets[currentPresetName] = deepClone(config);
    localStorage.setItem(CONFIG_KEY, JSON.stringify({
      currentPresetName,
      presets,
    }));
  } catch (e) {
    console.warn('配置保存失败', e);
  }
}

function deepMerge(target, source) {
  for (const key in source) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

function deepMergePresets(target, source) {
  for (const name in source) {
    if (target[name]) {
      deepMerge(target[name], source[name]);
    } else {
      target[name] = deepClone(source[name]);
    }
  }
  return target;
}

function switchPreset(name) {
  if (!presets[name]) return;
  presets[currentPresetName] = deepClone(config);
  currentPresetName = name;
  config = deepClone(presets[name]);
  saveConfig();
  location.reload();
}

// ============================================
// FPS 统计
// ============================================
class FPSCounter {
  constructor() {
    this.frames = 0;
    this.lastTime = performance.now();
    this.value = 0;
  }
  tick() {
    this.frames++;
    const now = performance.now();
    if (now - this.lastTime >= 1000) {
      this.value = this.frames;
      this.frames = 0;
      this.lastTime = now;
      fpsDisplay.textContent = `FPS: ${this.value}`;
    }
  }
}
const fpsCounter = new FPSCounter();

// ============================================
// 初始化场景
// ============================================
function initScene() {
  scene = new THREE.Scene();
  applyBackground();

  camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 13, 28);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = config.exposure;
  renderer.physicallyCorrectLights = true;  // ADD THIS
  document.getElementById('canvas-container').appendChild(renderer.domElement);

  initPostProcessing();

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 10, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 5;
  controls.maxDistance = 60;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;

  setupLights();
  setupGround();
  setupBackWall();

  window.addEventListener('resize', onWindowResize);
}

function applyBackground() {
  if (!scene) return;
  const bg = config.background;
  scene.background = new THREE.Color(bg.color);
  scene.fog = new THREE.Fog(bg.fogColor, bg.fogNear, bg.fogFar);
}

function initPostProcessing() {
  const renderTarget = new THREE.WebGLRenderTarget(
    window.innerWidth,
    window.innerHeight,
    {
      samples: 4,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    }
  );
  composer = new EffectComposer(renderer, renderTarget);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    config.bloom.strength,
    config.bloom.radius,
    config.bloom.threshold
  );
  composer.addPass(bloomPass);

  colorGradingPass = new ShaderPass(ColorGradingShader);
  colorGradingPass.uniforms.saturation.value = config.colorGrading.saturation;
  colorGradingPass.uniforms.contrast.value = config.colorGrading.contrast;
  colorGradingPass.uniforms.brightness.value = config.colorGrading.brightness;
  colorGradingPass.uniforms.temperature.value = config.colorGrading.temperature;
  colorGradingPass.uniforms.gamma.value = config.colorGrading.gamma;
  composer.addPass(colorGradingPass);
}

function setupLights() {
  // 清除旧灯光
  Object.values(lights).forEach(l => {
    if (l && l.parent) l.parent.remove(l);
  });
  lights = {};

  // 环境光
  lights.ambient = new THREE.AmbientLight(
    new THREE.Color(config.ambient.color),
    config.ambient.intensity
  );
  scene.add(lights.ambient);

  // 日光 / 主光源
  lights.sun = new THREE.DirectionalLight(
    new THREE.Color(config.sun.color),
    config.sun.intensity
  );
  lights.sun.position.set(config.sun.posX, config.sun.posY, config.sun.posZ);
  lights.sun.castShadow = config.sun.castShadow;
  lights.sun.shadow.mapSize.width = config.sun.shadowSize;
  lights.sun.shadow.mapSize.height = config.sun.shadowSize;
  lights.sun.shadow.camera.near = 0.5;
  lights.sun.shadow.camera.far = 80;
  lights.sun.shadow.camera.left = -25;
  lights.sun.shadow.camera.right = 25;
  lights.sun.shadow.camera.top = 25;
  lights.sun.shadow.camera.bottom = -25;
  lights.sun.shadow.bias = config.sun.shadowBias;
  scene.add(lights.sun);

  // 补光
  lights.fill = new THREE.DirectionalLight(
    new THREE.Color(config.fill.color),
    config.fill.intensity
  );
  lights.fill.position.set(-12, 10, -8);
  scene.add(lights.fill);

  // 轮廓光
  lights.rim = new THREE.DirectionalLight(
    new THREE.Color(config.rim.color),
    config.rim.intensity
  );
  lights.rim.position.set(-5, 8, -15);
  scene.add(lights.rim);

  // 半球光
  lights.hemi = new THREE.HemisphereLight(
    new THREE.Color(config.hemi.skyColor),
    new THREE.Color(config.hemi.groundColor),
    config.hemi.intensity
  );
  scene.add(lights.hemi);
}

function setupGround() {
  if (ground) {
    scene.remove(ground);
    ground.geometry.dispose();
    ground.material.dispose();
  }
  const groundGeo = new THREE.PlaneGeometry(200, 200);
  const groundMat = new THREE.ShadowMaterial({ opacity: 0.2 });
  ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);
}

function setupBackWall() {
  if (backWall) {
    scene.remove(backWall);
    backWall.geometry.dispose();
    backWall.material.dispose();
    backWall = null;
  }
  const wallGeo = new THREE.PlaneGeometry(36, 36);
  const wallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(config.wall.color),
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  backWall = new THREE.Mesh(wallGeo, wallMat);
  backWall.position.set(0, 15, config.wall.posZ);
  backWall.receiveShadow = config.wall.receiveShadow;
  backWall.castShadow = false;
  backWall.visible = config.wall.visible;
  scene.add(backWall);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) {
    composer.setSize(window.innerWidth, window.innerHeight);
    if (composer.renderTarget1) composer.renderTarget1.samples = 4;
    if (composer.renderTarget2) composer.renderTarget2.samples = 4;
  }
}

// ============================================
// Color Grading Shader - 饱和度/对比度/色温
// ============================================
const ColorGradingShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1.15 },
    contrast: { value: 1.08 },
    brightness: { value: 0.0 },
    temperature: { value: 0.0 },
    gamma: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float contrast;
    uniform float brightness;
    uniform float temperature;
    uniform float gamma;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;

      // Gamma
      color = pow(max(color, vec3(0.0)), vec3(1.0 / gamma));

      // Brightness (offset)
      color = color + vec3(brightness);

      // Contrast
      color = (color - 0.5) * contrast + 0.5;

      // Saturation
      float luminance = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(luminance), color, saturation);

      // Temperature: warm shadows/cool highlights or vice versa
      vec3 warm = vec3(0.02, 0.005, -0.025);
      vec3 cool = vec3(-0.01, 0.0, 0.015);
      vec3 tempOffset = mix(cool, warm, luminance) * temperature;
      color = color + tempOffset;

      color = clamp(color, 0.0, 1.0);
      gl_FragColor = vec4(color, texel.a);
    }
  `
};

// ============================================
// Toon 渐变纹理
// ============================================
const toonGradientCache = new Map();

function createToonGradient(steps = 3, colors = ['#888888', '#cccccc', '#ffffff']) {
  const key = steps + '-' + colors.join(',');
  if (toonGradientCache.has(key)) return toonGradientCache.get(key);

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');

  const stepWidth = canvas.width / steps;
  for (let i = 0; i < steps; i++) {
    ctx.fillStyle = colors[Math.min(i, colors.length - 1)];
    ctx.fillRect(i * stepWidth, 0, stepWidth + 1, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;

  toonGradientCache.set(key, texture);
  return texture;
}

const TOON_GRADIENTS = {
  standard: createToonGradient(3, ['#666666', '#bbbbbb', '#ffffff']),
  soft: createToonGradient(4, ['#999999', '#bbbbbb', '#dddddd', '#ffffff']),
  hard: createToonGradient(2, ['#888888', '#ffffff']),
  mmd: createToonGradient(3, ['#555555', '#aaaaaa', '#ffffff']),
  anime: createToonGradient(3, ['#4a5a88', '#aaaaaa', '#ffffff']), // blue-purple shadow
};

// ============================================
// 材质处理 - 智能三渲二增强
// ============================================
function processModelMaterials(modelMesh) {
  modelMesh.traverse((child) => {
    if (!child.isMesh || !child.material) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];

    materials.forEach((mat) => {
      if (!mat) return;

      const matName = (mat.name || '').toLowerCase();
      const isSkin = /肌|皮|肤|skin|body|顔|脸/.test(matName);
      const isMMD = mat.isMMDToonMaterial === true;

      // 处理 MMDToonMaterial (MMDLoader 加载的材质)
      if (isMMD) {
        if (isSkin) {
          mat.shininess = config.skin.shininess;
          skinMaterials.push(mat);
        }
        if (mat.emissive && mat.emissive.setRGB) {
          mat.emissive.setRGB(0, 0, 0);
        }
      }
      else if (mat.isMeshToonMaterial) {
        if (!mat.gradientMap) {
          mat.gradientMap = TOON_GRADIENTS.anime;
        }
        mat.emissive.setRGB(0, 0, 0);
      }
      else if (mat.isMeshPhongMaterial || mat.isMeshLambertMaterial || mat.isMeshStandardMaterial) {
        let newMat;
        if (isSkin) {
          newMat = new THREE.MeshPhongMaterial({
            color: mat.color ? mat.color.clone() : new THREE.Color(1, 1, 1),
            map: mat.map || null,
            transparent: mat.transparent || false,
            opacity: mat.opacity !== undefined ? mat.opacity : 1.0,
            alphaTest: mat.alphaTest || 0.01,
            side: mat.side || THREE.FrontSide,
            shininess: config.skin.shininess,
            reflectivity: config.skin.reflectivity,
          });
          skinMaterials.push(newMat);
        } else {
          newMat = new THREE.MeshToonMaterial({
            color: mat.color ? mat.color.clone() : new THREE.Color(1, 1, 1),
            map: mat.map || null,
            transparent: mat.transparent || false,
            opacity: mat.opacity !== undefined ? mat.opacity : 1.0,
            alphaTest: mat.alphaTest || 0.01,
            side: mat.side || THREE.FrontSide,
            gradientMap: TOON_GRADIENTS.anime,
          });
        }
        newMat.emissive = new THREE.Color(0, 0, 0);
        if (mat.emissiveMap) newMat.emissiveMap = mat.emissiveMap;
        if (mat.normalMap) newMat.normalMap = mat.normalMap;
        if (mat.specularMap) newMat.specularMap = mat.specularMap;
        if (mat.lightMap) newMat.lightMap = mat.lightMap;
        newMat.userData = { ...mat.userData, originalMaterial: mat };
        const idx = materials.indexOf(mat);
        if (idx >= 0) materials[idx] = newMat;
      }

      // 确保两种模式下都正确设置阴影
      child.castShadow = true;
      child.receiveShadow = true;

      // 透明材质
      if (mat.transparent) {
        mat.depthWrite = false;
      }
    });

    if (Array.isArray(child.material)) {
      child.material = materials;
    }

    // 边缘线已移除
  });
}



// ============================================
// 加载进度
// ============================================
function updateProgress(text, percent) {
  loadingText.textContent = text;
  progressFill.style.width = Math.min(100, Math.max(0, percent)) + '%';
}

// ============================================
// 从用户上传的文件夹加载模型
// ============================================
// 规范化路径：统一正斜杠，移除 ./ 前缀
function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

async function loadModelFromFiles(files, targetPmxPath = null) {
  const manager = new THREE.LoadingManager();
  const fileMap = new Map();
  const blobMap = new Map();

  for (const file of files) {
    const path = normalizePath(filePathMap.get(file) || file.webkitRelativePath || file.name);
    fileMap.set(path, file);
  }

  let pmxEntry;
  if (targetPmxPath && fileMap.has(targetPmxPath)) {
    pmxEntry = [targetPmxPath, fileMap.get(targetPmxPath)];
  } else {
    pmxEntry = [...fileMap.entries()].find(([path, f]) => f.name.toLowerCase().endsWith('.pmx'));
  }
  if (!pmxEntry) throw new Error('未在文件夹中找到 .pmx 模型文件');
  const [pmxPath, pmxFile] = pmxEntry;
  const baseDir = pmxPath.substring(0, pmxPath.lastIndexOf('/') + 1);

  for (const [path, file] of fileMap) {
    blobMap.set(path, URL.createObjectURL(file));
  }

  manager.setURLModifier((rawUrl) => {
    const url = normalizePath(rawUrl);
    if (blobMap.has(url)) return blobMap.get(url);
    const candidate1 = baseDir + url;
    if (blobMap.has(candidate1)) return blobMap.get(candidate1);
    // 处理 url 可能包含 .. 的情况（如 ../toon/toon2.png）
    if (url.includes('..')) {
      const parts = (baseDir + url).split('/').filter(Boolean);
      const resolved = [];
      for (const part of parts) {
        if (part === '..') resolved.pop();
        else resolved.push(part);
      }
      const candidate2 = resolved.join('/');
      if (blobMap.has(candidate2)) return blobMap.get(candidate2);
    }
    const fileName = url.split('/').pop();
    for (const [path, blobUrl] of blobMap) {
      if (path.endsWith('/' + fileName) || path === fileName) {
        return blobUrl;
      }
    }
    console.warn('[Texture] 未找到贴图映射:', rawUrl, '→ 尝试加载原始 URL');
    return url;
  });

  const newLoader = new MMDLoader(manager);
  const newMesh = await new Promise((resolve, reject) => {
    // 使用 loadPMX 避免 blob URL 后缀检查问题
    newLoader.loadPMX(blobMap.get(pmxPath), (data) => {
      try {
        const mesh = newLoader.meshBuilder.build(data, '');
        resolve(mesh);
      } catch (e) {
        reject(e);
      }
    }, (xhr) => {
      if (xhr.lengthComputable) {
        const p = 5 + (xhr.loaded / xhr.total) * 45;
        updateProgress('正在加载 PMX 模型...', p);
      }
    }, reject);
  });

  return { loader: newLoader, mesh: newMesh };
}

// ============================================
// 加载 MMD 资源（支持文件上传）
// ============================================
async function loadMMD(modelFiles, motionFile, audioFile, expressionFile, cameraFile) {
  // 清理旧资源
  if (mesh) {
    scene.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    mesh = null;
  }
  if (audio) {
    audio.pause();
    audio.src = '';
    audio = null;
  }
  vmdClip = null;
  helper = new MMDAnimationHelper({ afterglow: 2.0 });
  isPlaying = false;
  animClock.stop();
  animClock = new THREE.Clock(false);

  // 重置时间轴
  const timeline = document.getElementById('timeline');
  if (timeline) { timeline.value = 0; timeline.max = 0; }
  updateTimelineUI(0, 0);

  // 1. 加载模型
  updateProgress('正在解析模型文件夹...', 0);
  const { loader: newLoader, mesh: newMesh } = await loadModelFromFiles(modelFiles, selectedPmxPath);
  loader = newLoader;
  mesh = newMesh;

  console.log('模型加载完成:', mesh);
  updateProgress('模型加载完成，处理材质与边缘线...', 50);

  // 2. 处理材质
  processModelMaterials(mesh);
  scene.add(mesh);

  // 3. 加载动作（支持动作+表情叠加）
  const clips = [];
  let motionDuration = 0;

  if (motionFile) {
    updateProgress('正在加载 VMD 动作数据...', 55);
    const vmdUrl = URL.createObjectURL(motionFile);
    const motionClip = await new Promise((resolve, reject) => {
      loader.loadAnimation(vmdUrl, mesh, (clip) => {
        resolve(clip);
      }, (xhr) => {
        if (xhr.lengthComputable) {
          const p = 55 + (xhr.loaded / xhr.total) * 20;
          updateProgress('正在加载 VMD 动作数据...', p);
        }
      }, (err) => {
        console.error('动作加载错误:', err);
        reject(new Error('动作加载失败: ' + (err.message || err)));
      });
    });
    if (motionClip) {
      clips.push(motionClip);
      motionDuration = motionClip.duration || 0;
      console.log('动作加载完成，时长:', motionDuration.toFixed(2));
    }
  }

  if (expressionFile) {
    updateProgress('正在加载表情动作数据...', 78);
    const exprUrl = URL.createObjectURL(expressionFile);
    const exprClip = await new Promise((resolve, reject) => {
      loader.loadAnimation(exprUrl, mesh, (clip) => {
        resolve(clip);
      }, (xhr) => {
        if (xhr.lengthComputable) {
          const p = 78 + (xhr.loaded / xhr.total) * 7;
          updateProgress('正在加载表情动作数据...', p);
        }
      }, (err) => {
        console.error('表情动作加载错误:', err);
        reject(new Error('表情动作加载失败: ' + (err.message || err)));
      });
    });
    if (exprClip) {
      clips.push(exprClip);
      console.log('表情动作加载完成，时长:', exprClip.duration.toFixed(2));
    }
  }

  if (clips.length > 0) {
    helper.add(mesh, { animation: clips, physics: true });
    // 设置为 LoopOnce：播放到最后一帧停住，不回卷
    const meshObj = helper.objects.get(mesh);
    if (meshObj && meshObj.mixer) {
      meshObj.mixer._actions.forEach(action => {
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
      });
    }
    animationDuration = motionDuration || Math.max(...clips.map(c => c.duration || 0));
    console.log('动画叠加完成，时间轴总长:', animationDuration.toFixed(2));
  }

  // 4. 加载镜头动作
  if (cameraFile) {
    updateProgress('正在加载镜头动作数据...', 88);
    const camUrl = URL.createObjectURL(cameraFile);
    const cameraClip = await new Promise((resolve, reject) => {
      loader.loadAnimation(camUrl, camera, (clip) => {
        resolve(clip);
      }, (xhr) => {
        if (xhr.lengthComputable) {
          const p = 88 + (xhr.loaded / xhr.total) * 7;
          updateProgress('正在加载镜头动作数据...', p);
        }
      }, (err) => {
        console.error('镜头动作加载错误:', err);
        reject(new Error('镜头动作加载失败: ' + (err.message || err)));
      });
    });
    if (cameraClip) {
      helper.add(camera, { animation: cameraClip });
      // 镜头动画也设为 LoopOnce
      const camObj = helper.objects.get(camera);
      if (camObj && camObj.mixer) {
        camObj.mixer._actions.forEach(action => {
          action.setLoop(THREE.LoopOnce);
          action.clampWhenFinished = true;
        });
      }
      animationDuration = Math.max(animationDuration, cameraClip.duration || 0);
      console.log('镜头动作加载完成，时长:', cameraClip.duration.toFixed(2), '→ 时间轴总长:', animationDuration.toFixed(2));
    }
  }

  // 更新时间轴最大值
  if (timeline) timeline.max = animationDuration;

  // 5. 加载音频
  if (audioFile) {
    updateProgress('正在加载音频...', 85);
    try {
      const audioUrl = URL.createObjectURL(audioFile);
      audio = new Audio(audioUrl);
      audio.crossOrigin = 'anonymous';
      audio.preload = 'auto';
      audio.loop = false;

      await new Promise((resolve, reject) => {
        audio.addEventListener('canplaythrough', resolve, { once: true });
        audio.addEventListener('error', () => reject(new Error('音频加载失败')), { once: true });
        setTimeout(() => reject(new Error('音频加载超时')), 8000);
      });

      console.log('音频加载完成');
    } catch (audioErr) {
      console.warn('音频加载失败，将无音频播放:', audioErr);
      audio = null;
    }
  }

  updateProgress('准备就绪', 100);
  setTimeout(() => {
    loadingEl.classList.add('hidden');
  }, 600);

  return mesh;
}

// ============================================
// UI 控制
// ============================================
function setupUI() {
  const btnToggle = document.getElementById('btn-toggle');

  function updatePlayButton() {
    btnToggle.textContent = isPlaying ? '⏸ 暂停' : '▶ 播放';
  }

  function syncPlay() {
    if (isPlaying) return;
    // 如果动画已结束，从头开始
    const meshObj = mesh ? helper.objects.get(mesh) : null;
    const current = meshObj && meshObj.mixer ? meshObj.mixer.time : 0;
    if (current >= animationDuration && animationDuration > 0) {
      seekTo(0);
    }
    autoStopped = false;
    isPlaying = true;
    if (!animClock.running) animClock.start();
    if (audio) {
      // 如果音频已自然结束，先重置到开头
      if (audio.ended) audio.currentTime = 0;
      audio.play().catch(e => console.warn('音频播放失败:', e));
    }
    updatePlayButton();
  }

  function syncPause() {
    if (!isPlaying) return;
    isPlaying = false;
    animClock.stop();
    if (audio) audio.pause();
    updatePlayButton();
  }

  function syncTogglePlay() {
    if (isPlaying) syncPause();
    else syncPlay();
  }

  btnToggle.addEventListener('click', syncTogglePlay);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      syncTogglePlay();
    }
  });
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function updateTimeDisplay() {
  let current = 0;
  try {
    const obj = mesh ? helper.objects.get(mesh) : null;
    if (obj && obj.mixer) {
      current = obj.mixer.time || 0;
    }
  } catch (e) {}
  timeDisplay.textContent = `${formatTime(current)} / ${formatTime(animationDuration)}`;
  return current;
}

function updateTimelineUI(current, total) {
  const tlTime = document.getElementById('timeline-time');
  if (tlTime) tlTime.textContent = `${formatTime(current)} / ${formatTime(total)}`;
}

// ============================================
// ============================================
// 递归读取拖拽的文件夹（修复：循环 readEntries 直到读完）
// ============================================
function readDirectoryEntry(dirEntry, files = [], basePath = '') {
  return new Promise((resolve) => {
    const reader = dirEntry.createReader();

    function readBatch() {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(files);
          return;
        }
        const promises = entries.map((entry) => {
          const path = basePath ? basePath + '/' + entry.name : entry.name;
          if (entry.isDirectory) {
            return readDirectoryEntry(entry, files, path);
          } else {
            return new Promise((res, rej) => {
              entry.file((file) => {
                filePathMap.set(file, path);
                files.push(file);
                res();
              }, rej);
            });
          }
        });
        Promise.all(promises).then(() => readBatch()).catch(() => readBatch());
      });
    }

    readBatch();
  });
}

// ============================================
// 预设选择器
// ============================================
function initPresetSelector() {
  const container = document.getElementById('preset-list');
  if (!container) return;
  const names = Object.keys(presets);
  container.innerHTML = names.map((n, i) => `
    <div class="preset-radio-row">
      <input type="radio" name="preset-choice" id="preset-${i}" value="${n}" ${n === currentPresetName ? 'checked' : ''}>
      <label for="preset-${i}">${n}</label>
    </div>
  `).join('');
  container.querySelectorAll('input[name="preset-choice"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) switchPreset(e.target.value);
    });
  });
}

// ============================================
// 文件上传面板
// ============================================
function setupDropZone(el, onDrop) {
  let dragCounter = 0;

  el.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    el.classList.add('drag-over');
  }, false);

  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, false);

  el.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      el.classList.remove('drag-over');
    }
  }, false);

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    el.classList.remove('drag-over');

    // 优先使用 items（支持文件夹），否则回退到 files
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      onDrop(Array.from(items));
    } else {
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        onDrop(Array.from(files));
      }
    }
  }, false);
}

function initFileUpload() {
  const inputModel = document.getElementById('input-model');
  const inputMotion = document.getElementById('input-motion');
  const inputAudio = document.getElementById('input-audio');
  const inputExpression = document.getElementById('input-expression');
  const inputCamera = document.getElementById('input-camera');
  const btnLoad = document.getElementById('btn-load');

  const dropModel = document.getElementById('drop-model');
  const dropMotion = document.getElementById('drop-motion');
  const dropAudio = document.getElementById('drop-audio');
  const dropExpression = document.getElementById('drop-expression');
  const dropCamera = document.getElementById('drop-camera');

  // 检测浏览器是否支持拖拽文件夹（webkitGetAsEntry）
  const supportsFolderDrop = typeof DataTransferItem !== 'undefined' &&
    typeof DataTransferItem.prototype.webkitGetAsEntry === 'function';
  const dragHintModel = document.getElementById('drag-hint-model');
  if (dragHintModel && !supportsFolderDrop) {
    dragHintModel.classList.add('visible');
  }

  function updateModelStatus(files) {
    const pmx = [...files].find(f => f.name.toLowerCase().endsWith('.pmx'));
    const el = document.getElementById('model-status');
    el.textContent = pmx ? `✅ ${pmx.name} (+${files.length - 1} 个文件)` : '❌ 未找到 .pmx 文件';
    el.classList.toggle('empty', !pmx);
  }

  function buildPmxSelector(files) {
    const container = document.getElementById('pmx-selector');
    if (!container) return;
    const pmxFiles = [...files].filter(f => f.name.toLowerCase().endsWith('.pmx'));
    if (pmxFiles.length <= 1) {
      container.classList.remove('visible');
      container.innerHTML = '';
      selectedPmxPath = null;
      return;
    }
    container.innerHTML = '<div class="section-title">选择模型</div>';
    pmxFiles.forEach((f, i) => {
      const path = normalizePath(filePathMap.get(f) || f.webkitRelativePath || f.name);
      const row = document.createElement('div');
      row.className = 'pmx-radio-row';
      row.innerHTML = `
        <input type="radio" name="pmx-choice" id="pmx-${i}" value="${path}" ${i === 0 ? 'checked' : ''}>
        <label for="pmx-${i}">${f.name}</label>
      `;
      container.appendChild(row);
    });
    container.classList.add('visible');
    // 默认选中第一个
    selectedPmxPath = normalizePath(filePathMap.get(pmxFiles[0]) || pmxFiles[0].webkitRelativePath || pmxFiles[0].name);
    // 绑定 change 事件
    container.querySelectorAll('input[name="pmx-choice"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        if (e.target.checked) selectedPmxPath = e.target.value;
      });
    });
  }

  inputModel.addEventListener('change', (e) => {
    selectedModelFiles = e.target.files;
    updateModelStatus(selectedModelFiles);
    buildPmxSelector(selectedModelFiles);
    if (dropModel) dropModel.classList.toggle('has-file', selectedModelFiles && selectedModelFiles.length > 0);
  });

  inputMotion.addEventListener('change', (e) => {
    selectedMotionFile = e.target.files[0];
    const el = document.getElementById('motion-name');
    el.textContent = selectedMotionFile ? selectedMotionFile.name : '未选择';
    el.classList.toggle('empty', !selectedMotionFile);
    if (dropMotion) dropMotion.classList.toggle('has-file', !!selectedMotionFile);
  });

  inputAudio.addEventListener('change', (e) => {
    selectedAudioFile = e.target.files[0];
    const el = document.getElementById('audio-name');
    el.textContent = selectedAudioFile ? selectedAudioFile.name : '未选择';
    el.classList.toggle('empty', !selectedAudioFile);
    if (dropAudio) dropAudio.classList.toggle('has-file', !!selectedAudioFile);
  });

  inputExpression.addEventListener('change', (e) => {
    selectedExpressionFile = e.target.files[0];
    const el = document.getElementById('expression-name');
    el.textContent = selectedExpressionFile ? selectedExpressionFile.name : '未选择';
    el.classList.toggle('empty', !selectedExpressionFile);
    if (dropExpression) dropExpression.classList.toggle('has-file', !!selectedExpressionFile);
  });

  inputCamera.addEventListener('change', (e) => {
    selectedCameraFile = e.target.files[0];
    const el = document.getElementById('camera-name');
    el.textContent = selectedCameraFile ? selectedCameraFile.name : '未选择';
    el.classList.toggle('empty', !selectedCameraFile);
    if (dropCamera) dropCamera.classList.toggle('has-file', !!selectedCameraFile);
  });

  // 点击 drop-field 触发对应 input
  if (dropModel) dropModel.addEventListener('click', (e) => {
    if (e.target.classList.contains('drop-clear')) return;
    inputModel.click();
  });
  if (dropMotion) dropMotion.addEventListener('click', (e) => {
    if (e.target.classList.contains('drop-clear')) return;
    inputMotion.click();
  });
  if (dropAudio) dropAudio.addEventListener('click', (e) => {
    if (e.target.classList.contains('drop-clear')) return;
    inputAudio.click();
  });
  if (dropExpression) dropExpression.addEventListener('click', (e) => {
    if (e.target.classList.contains('drop-clear')) return;
    inputExpression.click();
  });
  if (dropCamera) dropCamera.addEventListener('click', (e) => {
    if (e.target.classList.contains('drop-clear')) return;
    inputCamera.click();
  });

  // 删除按钮事件
  document.querySelectorAll('.drop-clear').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = btn.dataset.target;
      switch (target) {
        case 'model':
          selectedModelFiles = null;
          selectedPmxPath = null;
          document.getElementById('model-status').textContent = '未选择';
          document.getElementById('model-status').classList.add('empty');
          document.getElementById('pmx-selector').innerHTML = '';
          document.getElementById('pmx-selector').classList.remove('visible');
          inputModel.value = '';
          if (dropModel) dropModel.classList.remove('has-file');
          break;
        case 'motion':
          selectedMotionFile = null;
          document.getElementById('motion-name').textContent = '未选择';
          document.getElementById('motion-name').classList.add('empty');
          inputMotion.value = '';
          if (dropMotion) dropMotion.classList.remove('has-file');
          break;
        case 'audio':
          selectedAudioFile = null;
          document.getElementById('audio-name').textContent = '未选择';
          document.getElementById('audio-name').classList.add('empty');
          inputAudio.value = '';
          if (dropAudio) dropAudio.classList.remove('has-file');
          break;
        case 'expression':
          selectedExpressionFile = null;
          document.getElementById('expression-name').textContent = '未选择';
          document.getElementById('expression-name').classList.add('empty');
          inputExpression.value = '';
          if (dropExpression) dropExpression.classList.remove('has-file');
          break;
        case 'camera':
          selectedCameraFile = null;
          document.getElementById('camera-name').textContent = '未选择';
          document.getElementById('camera-name').classList.add('empty');
          inputCamera.value = '';
          if (dropCamera) dropCamera.classList.remove('has-file');
          break;
      }
    });
  });

  // 页面级别阻止默认拖拽行为（防止文件被浏览器打开）
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.body.addEventListener(eventName, (e) => {
      e.preventDefault();
      // 不要 stopPropagation，让 drop-zone 自己能处理事件
    }, false);
  });

  // 模型拖拽区：接受文件夹和文件，递归遍历子目录
  if (dropModel) {
    setupDropZone(dropModel, async (entries) => {
      const files = [];
      for (const entry of entries) {
        if (entry.kind === 'file') {
          // DataTransferItem
          const fsEntry = entry.webkitGetAsEntry ? entry.webkitGetAsEntry() : null;
          if (fsEntry && fsEntry.isDirectory) {
            const dirFiles = await readDirectoryEntry(fsEntry);
            files.push(...dirFiles);
          } else {
            const file = entry.getAsFile ? entry.getAsFile() : null;
            if (file) {
              filePathMap.set(file, file.name);
              files.push(file);
            }
          }
        } else if (entry instanceof File) {
          // File fallback
          filePathMap.set(entry, entry.name);
          files.push(entry);
        }
      }
      if (files.length > 0) {
        selectedModelFiles = files;
        updateModelStatus(files);
        buildPmxSelector(files);
        dropModel.classList.add('has-file');
      }
    });
  }

  // 动作拖拽区
  if (dropMotion) {
    setupDropZone(dropMotion, async (entries) => {
      for (const entry of entries) {
        let file = null;
        if (entry.kind === 'file') {
          file = entry.getAsFile ? entry.getAsFile() : null;
        } else if (entry instanceof File) {
          file = entry;
        }
        if (file && file.name.toLowerCase().endsWith('.vmd')) {
          selectedMotionFile = file;
          const el = document.getElementById('motion-name');
          el.textContent = file.name;
          el.classList.remove('empty');
          dropMotion.classList.add('has-file');
          break;
        }
      }
    });
  }

  // 音乐拖拽区
  if (dropAudio) {
    setupDropZone(dropAudio, async (entries) => {
      for (const entry of entries) {
        let file = null;
        if (entry.kind === 'file') {
          file = entry.getAsFile ? entry.getAsFile() : null;
        } else if (entry instanceof File) {
          file = entry;
        }
        if (!file) continue;
        const name = file.name.toLowerCase();
        if (file.type.startsWith('audio/') || name.endsWith('.wav') || name.endsWith('.mp3') || name.endsWith('.ogg')) {
          selectedAudioFile = file;
          const el = document.getElementById('audio-name');
          el.textContent = file.name;
          el.classList.remove('empty');
          dropAudio.classList.add('has-file');
          break;
        }
      }
    });
  }

  // 表情动作拖拽区
  if (dropExpression) {
    setupDropZone(dropExpression, async (entries) => {
      for (const entry of entries) {
        let file = null;
        if (entry.kind === 'file') {
          file = entry.getAsFile ? entry.getAsFile() : null;
        } else if (entry instanceof File) {
          file = entry;
        }
        if (file && file.name.toLowerCase().endsWith('.vmd')) {
          selectedExpressionFile = file;
          const el = document.getElementById('expression-name');
          el.textContent = file.name;
          el.classList.remove('empty');
          dropExpression.classList.add('has-file');
          break;
        }
      }
    });
  }

  // 镜头动作拖拽区
  if (dropCamera) {
    setupDropZone(dropCamera, async (entries) => {
      for (const entry of entries) {
        let file = null;
        if (entry.kind === 'file') {
          file = entry.getAsFile ? entry.getAsFile() : null;
        } else if (entry instanceof File) {
          file = entry;
        }
        if (file && file.name.toLowerCase().endsWith('.vmd')) {
          selectedCameraFile = file;
          const el = document.getElementById('camera-name');
          el.textContent = file.name;
          el.classList.remove('empty');
          dropCamera.classList.add('has-file');
          break;
        }
      }
    });
  }

  // 环境光强度实时调节
  const ambientSlider = document.getElementById('ambient-intensity');
  const ambientVal = document.getElementById('ambient-intensity-val');
  if (ambientSlider && ambientVal) {
    ambientSlider.value = config.ambient.intensity;
    ambientVal.textContent = config.ambient.intensity.toFixed(2);
    ambientSlider.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      config.ambient.intensity = v;
      ambientVal.textContent = v.toFixed(2);
      if (lights.ambient) {
        lights.ambient.intensity = v;
      }
      saveConfig();
    });
  }

  // 背景颜色实时调节
  const bgColorInput = document.getElementById('bg-color');
  if (bgColorInput) {
    bgColorInput.value = config.background.color;
    bgColorInput.addEventListener('input', (e) => {
      const v = e.target.value;
      config.background.color = v;
      if (scene) {
        scene.background = new THREE.Color(v);
      }
      saveConfig();
    });
  }

  // 墙壁控制
  const wallVisible = document.getElementById('wall-visible');
  const wallColor = document.getElementById('wall-color');
  const wallPosZ = document.getElementById('wall-posZ');
  const wallPosZVal = document.getElementById('wall-posZ-val');
  const wallSub = document.getElementById('wall-sub');

  if (wallVisible) {
    wallVisible.checked = config.wall.visible;
    wallVisible.addEventListener('change', (e) => {
      config.wall.visible = e.target.checked;
      wallSub.classList.toggle('visible', e.target.checked);
      updateWall();
    });
    wallSub.classList.toggle('visible', config.wall.visible);
  }
  if (wallColor) {
    wallColor.value = config.wall.color;
    wallColor.addEventListener('input', (e) => {
      config.wall.color = e.target.value;
      updateWall();
    });
  }
  if (wallPosZ && wallPosZVal) {
    wallPosZ.value = config.wall.posZ;
    wallPosZVal.textContent = config.wall.posZ.toFixed(2);
    wallPosZ.addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      config.wall.posZ = v;
      wallPosZVal.textContent = v.toFixed(2);
      updateWall();
    });
  }

  // 时间轴初始化
  const timeline = document.getElementById('timeline');
  if (timeline) {
    timeline.addEventListener('input', (e) => {
      isSeeking = true;
      const time = parseFloat(e.target.value);
      seekTo(time);
      updateTimelineUI(time, animationDuration);
    });
    timeline.addEventListener('change', () => {
      isSeeking = false;
    });
  }

  btnLoad.addEventListener('click', async () => {
    if (!selectedModelFiles) {
      alert('请先选择模型文件夹');
      return;
    }
    loadingEl.classList.remove('hidden');
    updateProgress('正在初始化...', 0);

    try {
      await loadMMD(selectedModelFiles, selectedMotionFile, selectedAudioFile, selectedExpressionFile, selectedCameraFile);
    } catch (err) {
      console.error('加载失败:', err);
      loadingText.textContent = '加载失败: ' + err.message;
      progressFill.style.width = '100%';
      progressFill.style.background = '#ff3333';
    }
  });
}

// ============================================
// GUI 面板
// ============================================
function setupGUI() {
  const gui = new GUI({ title: '渲染控制面板' });
  gui.domElement.style.marginTop = '10px';
  gui.domElement.style.marginRight = '10px';
  gui.close(); // 默认折叠

  // 全局曝光
  gui.add(config, 'exposure', 0.1, 3.0).name('全局曝光').onChange((v) => {
    renderer.toneMappingExposure = v;
    saveConfig();
  });

  // ---- 日光参数 ----
  const sunFolder = gui.addFolder('☀️ 日光参数');
  sunFolder.add(config.sun, 'enabled').name('启用日光').onChange(updateLights);
  sunFolder.addColor(config.sun, 'color').name('颜色').onChange(updateLights);
  sunFolder.add(config.sun, 'intensity', 0, 5).name('强度').onChange(updateLights);
  sunFolder.add(config.sun, 'posX', -30, 30).name('位置 X').onChange(updateLights);
  sunFolder.add(config.sun, 'posY', 0, 40).name('位置 Y').onChange(updateLights);
  sunFolder.add(config.sun, 'posZ', -30, 30).name('位置 Z').onChange(updateLights);
  sunFolder.add(config.sun, 'castShadow').name('投射阴影').onChange(updateLights);
  sunFolder.add(config.sun, 'shadowBias', -0.01, 0.01).name('阴影偏移').onChange(updateLights);
  sunFolder.add(config.sun, 'shadowSize', 512, 4096, 512).name('阴影精度').onChange(updateLights);

  // ---- 环境光照 ----
  const envFolder = gui.addFolder('🌍 环境光照');
  envFolder.addColor(config.ambient, 'color').name('环境光颜色').onChange(updateLights);
  envFolder.add(config.ambient, 'intensity', 0, 2).name('环境光强度').onChange(updateLights);
  envFolder.addColor(config.hemi, 'skyColor').name('半球光天空').onChange(updateLights);
  envFolder.addColor(config.hemi, 'groundColor').name('半球光地面').onChange(updateLights);
  envFolder.add(config.hemi, 'intensity', 0, 2).name('半球光强度').onChange(updateLights);
  envFolder.addColor(config.fill, 'color').name('补光颜色').onChange(updateLights);
  envFolder.add(config.fill, 'intensity', 0, 2).name('补光强度').onChange(updateLights);
  envFolder.addColor(config.rim, 'color').name('轮廓光颜色').onChange(updateLights);
  envFolder.add(config.rim, 'intensity', 0, 2).name('轮廓光强度').onChange(updateLights);

  // ---- 背景 ----
  const bgFolder = gui.addFolder('🌌 背景');
  bgFolder.addColor(config.background, 'color').name('背景色').onChange(updateBackground);
  bgFolder.addColor(config.background, 'fogColor').name('雾颜色').onChange(updateBackground);
  bgFolder.add(config.background, 'fogNear', 0, 100).name('雾起始').onChange(updateBackground);
  bgFolder.add(config.background, 'fogFar', 50, 300).name('雾结束').onChange(updateBackground);

  // ---- 墙壁 ----
  const wallFolder = gui.addFolder('🧱 白色墙壁');
  wallFolder.add(config.wall, 'visible').name('显示墙壁').onChange(updateWall);
  wallFolder.addColor(config.wall, 'color').name('墙壁颜色').onChange(updateWall);
  wallFolder.add(config.wall, 'posZ', -30, 0).name('墙壁位置 Z').onChange(updateWall);
  wallFolder.add(config.wall, 'receiveShadow').name('接收阴影').onChange(updateWall);

  // ---- Bloom ----
  const bloomFolder = gui.addFolder('✨ Bloom 辉光');
  bloomFolder.add(config.bloom, 'strength', 0, 2).name('强度').onChange(updateBloom);
  bloomFolder.add(config.bloom, 'radius', 0, 2).name('半径').onChange(updateBloom);
  bloomFolder.add(config.bloom, 'threshold', 0, 1).name('阈值').onChange(updateBloom);

  // ---- Color Grading ----
  const cgFolder = gui.addFolder('🎨 色彩调整');
  cgFolder.add(config.colorGrading, 'saturation', 0, 2, 0.01).name('饱和度').onChange(updateColorGrading);
  cgFolder.add(config.colorGrading, 'contrast', 0.5, 2, 0.01).name('对比度').onChange(updateColorGrading);
  cgFolder.add(config.colorGrading, 'brightness', -0.5, 0.5, 0.01).name('亮度').onChange(updateColorGrading);
  cgFolder.add(config.colorGrading, 'temperature', -1, 1, 0.01).name('色温').onChange(updateColorGrading);
  cgFolder.add(config.colorGrading, 'gamma', 0.5, 2, 0.01).name('Gamma').onChange(updateColorGrading);

  // 保存 / 重置 / 导出 / 导入
  const actions = {
    saveSettings: () => {
      saveConfig();
      alert('参数已保存到浏览器本地存储');
    },
    resetSettings: () => {
      if (confirm('确定恢复默认参数？')) {
        localStorage.removeItem(CONFIG_KEY);
        location.reload();
      }
    },
    exportSettings: () => {
      const json = JSON.stringify(config, null, 2);
      navigator.clipboard.writeText(json).then(() => {
        alert('配置已复制到剪贴板，请粘贴保存到文本文件');
      }).catch(() => {
        prompt('请复制以下配置文本：', json);
      });
    },
    importSettings: () => {
      const raw = prompt('请粘贴之前导出的配置 JSON：');
      if (!raw) return;
      try {
        const imported = JSON.parse(raw);
        // 验证基本结构
        if (typeof imported !== 'object') throw new Error('格式错误');
        // 合并到当前配置
        Object.assign(config, imported);
        saveConfig();
        alert('配置已导入，页面即将刷新');
        location.reload();
      } catch (e) {
        alert('导入失败：' + e.message);
      }
    },
  };
  gui.add(actions, 'saveSettings').name('💾 保存参数');
  gui.add(actions, 'exportSettings').name('📋 导出配置');
  gui.add(actions, 'importSettings').name('📥 导入配置');
  gui.add(actions, 'resetSettings').name('🔄 恢复默认');
}

function updateLights() {
  if (!lights.sun) return;
  lights.sun.color.set(config.sun.color);
  lights.sun.intensity = config.sun.enabled ? config.sun.intensity : 0;
  lights.sun.position.set(config.sun.posX, config.sun.posY, config.sun.posZ);
  lights.sun.castShadow = config.sun.castShadow;
  lights.sun.shadow.bias = config.sun.shadowBias;
  const s = config.sun.shadowSize;
  lights.sun.shadow.mapSize.set(s, s);
  lights.sun.shadow.mapSize.width = s;
  lights.sun.shadow.mapSize.height = s;
  if (lights.sun.shadow.map) {
    lights.sun.shadow.map.dispose();
    lights.sun.shadow.map = null;
  }

  lights.ambient.color.set(config.ambient.color);
  lights.ambient.intensity = config.ambient.intensity;
  lights.hemi.color.set(config.hemi.skyColor);
  lights.hemi.groundColor.set(config.hemi.groundColor);
  lights.hemi.intensity = config.hemi.intensity;
  lights.fill.color.set(config.fill.color);
  lights.fill.intensity = config.fill.intensity;
  lights.rim.color.set(config.rim.color);
  lights.rim.intensity = config.rim.intensity;

  saveConfig();
}

function updateWall() {
  if (!backWall) return;
  backWall.visible = config.wall.visible;
  backWall.material.color.set(config.wall.color);
  backWall.position.z = config.wall.posZ;
  backWall.receiveShadow = config.wall.receiveShadow;
  saveConfig();
}

function updateBloom() {
  if (!bloomPass) return;
  bloomPass.strength = config.bloom.strength;
  bloomPass.radius = config.bloom.radius;
  bloomPass.threshold = config.bloom.threshold;
  saveConfig();
}

function updateColorGrading() {
  if (!colorGradingPass) return;
  colorGradingPass.uniforms.saturation.value = config.colorGrading.saturation;
  colorGradingPass.uniforms.contrast.value = config.colorGrading.contrast;
  colorGradingPass.uniforms.brightness.value = config.colorGrading.brightness;
  colorGradingPass.uniforms.temperature.value = config.colorGrading.temperature;
  colorGradingPass.uniforms.gamma.value = config.colorGrading.gamma;
  saveConfig();
}

// ============================================
// 背景更新
// ============================================
function updateBackground() {
  applyBackground();
  saveConfig();
}

// ============================================
// 动画循环
// ============================================
const SMALL_SCREEN_INTERVAL = 1000 / 60; // 小屏幕限制60fps
let lastAnimateTime = 0;

function seekTo(time) {
  animClock.getDelta();

  const resetActions = (mixer) => {
    if (!mixer) return;
    mixer._actions.forEach(action => {
      action.paused = false;
      action.enabled = true;
    });
  };

  const meshObj = mesh ? helper.objects.get(mesh) : null;
  if (meshObj && meshObj.mixer) {
    resetActions(meshObj.mixer);
    meshObj.mixer.setTime(time);
  }
  const cameraObj = helper.objects.get(camera);
  if (cameraObj && cameraObj.mixer) {
    resetActions(cameraObj.mixer);
    cameraObj.mixer.setTime(time);
  }
  if (audio) {
    audio.currentTime = time;
    if (isPlaying) audio.play().catch(() => {});
  }
  timeDisplay.textContent = `${formatTime(time)} / ${formatTime(animationDuration)}`;
  const timeline = document.getElementById('timeline');
  if (timeline) {
    timeline.value = time;
    updateTimelineUI(time, animationDuration);
  }
}

function animate(timestamp) {
  animationId = requestAnimationFrame(animate);

  // 小屏幕帧率限制
  const isSmall = window.innerWidth < 1000 || window.innerHeight < 1000;
  if (isSmall) {
    if (!lastAnimateTime) lastAnimateTime = timestamp;
    const elapsed = timestamp - lastAnimateTime;
    if (elapsed < SMALL_SCREEN_INTERVAL) return;
    lastAnimateTime = timestamp - (elapsed % SMALL_SCREEN_INTERVAL);
  }

  if (isPlaying) {
    let delta = animClock.getDelta();
    // 截断 delta，防止动画超过结尾后循环回第一帧
    const meshObj = mesh ? helper.objects.get(mesh) : null;
    const current = meshObj && meshObj.mixer ? meshObj.mixer.time : 0;
    if (current + delta > animationDuration && animationDuration > 0) {
      delta = Math.max(0, animationDuration - current);
    }
    helper.update(delta);
    const newCurrent = updateTimeDisplay();
    // 同步时间轴
    const timeline = document.getElementById('timeline');
    if (timeline && !isSeeking) {
      timeline.value = newCurrent;
      updateTimelineUI(newCurrent, animationDuration);
    }
    // 自动停止（只触发一次）
    if (newCurrent >= animationDuration && animationDuration > 0 && !autoStopped) {
      autoStopped = true;
      isPlaying = false;
      animClock.stop();
      if (audio) audio.pause();
      const btnToggle = document.getElementById('btn-toggle');
      if (btnToggle) btnToggle.textContent = '▶ 播放';
    }
  }

  controls.update();
  fpsCounter.tick();
  composer.render();
}

// ============================================
// 启动
// ============================================
async function main() {
  try {
    if (typeof window.Ammo === 'undefined') {
      throw new Error('Ammo.js 未加载，请检查网络连接或刷新页面');
    }
    console.log('Ammo.js 已加载');

    initScene();
    applyBackground();
    setupUI();
    setupGUI();
    initPresetSelector();
    initFileUpload();
    animate();

    // 初始状态：等待用户上传文件
    loadingEl.classList.add('hidden');
    console.log('MMD 渲染器已就绪，请点击 📂 文件 选择模型文件夹');
  } catch (err) {
    console.error('启动失败:', err);
    loadingText.textContent = '加载失败: ' + err.message;
    progressFill.style.width = '100%';
    progressFill.style.background = '#ff3333';
  }
}

main();
