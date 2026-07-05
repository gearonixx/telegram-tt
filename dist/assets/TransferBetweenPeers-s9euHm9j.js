import{An as e,Bn as t,Bt as n,Cy as r,Dy as i,Eb as a,Ft as o,Gh as s,Ih as c,Jd as l,Jh as u,Kf as d,Kh as f,Ls as p,Mt as m,Qv as h,Rt as g,Ty as _,Xd as v,Xt as y,Yc as b,Yn as x,Zs as S,Zv as C,_t as w,_y as ee,an as T,ay as E,by as D,dy as O,el as k,gy as te,ht as ne,hy as A,iy as j,ly as re,mn as M,pf as N,pn as ie,pt as ae,py as P,qo as oe,ry as se,sy as ce,tn as F,vy as I,y as le}from"./index-ZsrbboX4.js";import{t as L}from"./Modal-CelUCEIo.js";import{i as ue}from"./Skeleton-D02AsGNX.js";import{t as de}from"./AnimatedIconWithPreview-BOj29O5b.js";import{At as fe,B as pe,Ct as me,Et as he,J as ge,Mt as _e}from"./ActionMessage-Be0rKUcM.js";import{s as R}from"./advancedColors-D_0Zzm4a.js";var ve=O(({ref:e,id:t,className:n,value:r,label:o,error:s,success:c,disabled:l,readOnly:d,placeholder:f,autoComplete:p,inputMode:h,maxLength:g,maxLengthIndicator:y,hasLengthIndicator:b,tabIndex:x,onChange:S,onInput:C,onKeyPress:w,onKeyDown:ee,onBlur:T,onPaste:D,noReplaceNewlines:O})=>{let k=I();e&&(k=e);let ne=F(),A=s||c||o,re=u(`input-group`,r&&`touched`,s?`error`:c&&`success`,l&&`disabled`,d&&`disabled`,A&&`with-label`,n),M=v(e=>{i(()=>{e.style.height=`0`,_(()=>{let t=e.scrollHeight;return()=>{e.style.height=`${t}px`}})})});te(()=>{let e=k.current;e&&M(e)},[]);let N=P(e=>{let t=e.currentTarget;if(!O){let e=t.selectionEnd;t.value=t.value.replace(/\n/g,` `),t.selectionEnd=e}M(t),S?.(e)},[O,S]);return E(`div`,{className:re,dir:ne.isRtl?`rtl`:void 0,children:[j(`textarea`,{ref:k,className:`form-control`,id:t,dir:`auto`,value:r||``,tabIndex:x,placeholder:f,maxLength:g,autoComplete:p,spellCheck:a?!1:void 0,inputMode:h,disabled:l,readOnly:d,onChange:N,onInput:C,onKeyPress:w,onKeyDown:ee,onBlur:T,onPaste:D,"aria-label":A}),A&&j(`label`,{htmlFor:t,children:A}),(y||b&&g!==void 0)&&j(`div`,{className:`max-length-indicator`,children:j(m,{text:y||Math.max(0,g-(r||``).length).toString()})})]})}),z={root:`Kdv89j1l`,top:`_0EdTY2mJ`,badge:`TvB5YSlK`,text:`lZY9nXge`},ye=O(({peer:e,avatarWebPhoto:t,avatarSize:n,text:r,badgeText:i,badgeIcon:a,className:s,badgeClassName:c,badgeIconClassName:l,textClassName:d,onClick:p})=>{let m=ie();return E(`div`,{className:u(z.root,p&&z.clickable,s),onClick:p,children:[E(`div`,{className:z.top,children:[j(o,{size:n,peer:e,webPhoto:t}),i&&E(`div`,{className:u(z.badge,c),dir:m.isRtl?`rtl`:`ltr`,children:[a&&j(f,{name:a,className:l}),i]})]}),r&&j(`p`,{className:u(z.text,d),children:r})]})}),be=new R(`#0098EA`),xe={blue:be,blueGradient:[new R(`#0158AF`),new R(`#67D0FF`)],purple:new R(`#966FFE`),purpleGradient:[new R(`#6B93FF`),new R(`#E46ACE`)],gold:new R(`#FFBF0A`),goldGradient:[new R(`#FDEB32`),new R(`#D75902`)]},Se={particleCount:5,distanceLimit:1,fadeInTime:.05,minLifetime:3,maxLifetime:3,maxStartTimeDelay:0,selfDestroyTime:3,minSpawnRadius:5,maxSpawnRadius:50},B={width:350,height:230,particleCount:100,color:be,speed:18,baseSize:6,minSpawnRadius:35,maxSpawnRadius:70,distanceLimit:.7,fadeInTime:.25,fadeOutTime:1,minLifetime:4,maxLifetime:6,maxStartTimeDelay:3,edgeFadeZone:50,centerShift:[0,0],accelerationFactor:3,selfDestroyTime:0},Ce=.67,we=1.33,Te=2.2,V=new Map;function Ee(e,t){let n=V.get(e);return n||(n=De(e),V.set(e,n)),n.addSystem(t)}function De(e){let n=e.getContext(`webgl`,{alpha:!0,antialias:!1,preserveDrawingBuffer:!1});if(!n)throw Error(`WebGL not supported`);let r=Ae(n,n.VERTEX_SHADER,Oe),i=Ae(n,n.FRAGMENT_SHADER,ke);if(!r||!i)throw Error(`Failed to create shaders`);let a=je(n,r,i);if(!a)throw Error(`Failed to create shader program`);let o=window.devicePixelRatio||1,s=new Map,c={attributes:{startPosition:n.getAttribLocation(a,`a_startPosition`),velocity:n.getAttribLocation(a,`a_velocity`),startTime:n.getAttribLocation(a,`a_startTime`),lifetime:n.getAttribLocation(a,`a_lifetime`),size:n.getAttribLocation(a,`a_size`),baseOpacity:n.getAttribLocation(a,`a_baseOpacity`),color:n.getAttribLocation(a,`a_color`)},uniforms:{resolution:n.getUniformLocation(a,`u_resolution`),time:n.getUniformLocation(a,`u_time`),canvasWidth:n.getUniformLocation(a,`u_canvasWidth`),canvasHeight:n.getUniformLocation(a,`u_canvasHeight`),accelerationFactor:n.getUniformLocation(a,`u_accelerationFactor`),fadeInTime:n.getUniformLocation(a,`u_fadeInTime`),fadeOutTime:n.getUniformLocation(a,`u_fadeOutTime`),edgeFadeZone:n.getUniformLocation(a,`u_edgeFadeZone`),rotationMatrices:n.getUniformLocation(a,`u_rotationMatrices`),spawnCenter:n.getUniformLocation(a,`u_spawnCenter`)}},l,u;function d(e){let t=new Me(e.seed),{config:r}=e,i=new Float32Array(r.particleCount*2),a=new Float32Array(r.particleCount*2),s=new Float32Array(r.particleCount),c=new Float32Array(r.particleCount),l=new Float32Array(r.particleCount),u=new Float32Array(r.particleCount),d=new Float32Array(r.particleCount*3);for(let n=0;n<r.particleCount;n++){let f=t.next()*Math.PI*2,p=t.nextBetween(r.minSpawnRadius,r.maxSpawnRadius),m=Math.cos(f),h=Math.sin(f),g=e.centerX+m*p,_=e.centerY+h*p;i[n*2]=g*o,i[n*2+1]=_*o,c[n]=t.nextBetween(r.minLifetime,r.maxLifetime),s[n]=t.next()*r.maxStartTimeDelay;let v=t.nextBetween(e.avgDistance*r.distanceLimit*.5,e.avgDistance*r.distanceLimit)/c[n]*o;a[n*2]=m*v,a[n*2+1]=h*v;let y=t.next();y<.3?l[n]=r.baseSize*Ce*o:y<.7?l[n]=r.baseSize*we*o:l[n]=r.baseSize*Te*o,u[n]=t.nextBetween(.3,.8);let[b,x,S]=Pe(r.color,t).coords;d[n*3]=b||0,d[n*3+1]=x||0,d[n*3+2]=S||0}n.bindBuffer(n.ARRAY_BUFFER,e.buffers.startPosition),n.bufferData(n.ARRAY_BUFFER,i,n.STATIC_DRAW),n.bindBuffer(n.ARRAY_BUFFER,e.buffers.velocity),n.bufferData(n.ARRAY_BUFFER,a,n.STATIC_DRAW),n.bindBuffer(n.ARRAY_BUFFER,e.buffers.startTime),n.bufferData(n.ARRAY_BUFFER,s,n.STATIC_DRAW),n.bindBuffer(n.ARRAY_BUFFER,e.buffers.lifetime),n.bufferData(n.ARRAY_BUFFER,c,n.STATIC_DRAW),n.bindBuffer(n.ARRAY_BUFFER,e.buffers.size),n.bufferData(n.ARRAY_BUFFER,l,n.STATIC_DRAW),n.bindBuffer(n.ARRAY_BUFFER,e.buffers.baseOpacity),n.bufferData(n.ARRAY_BUFFER,u,n.STATIC_DRAW),n.bindBuffer(n.ARRAY_BUFFER,e.buffers.color),n.bufferData(n.ARRAY_BUFFER,d,n.STATIC_DRAW)}function f(){let t=0,r=0;s.forEach(e=>{t=Math.max(t,e.config.width),r=Math.max(r,e.config.height)}),s.size===0&&(t=B.width,r=B.height),(e.width!==t*o||e.height!==r*o)&&(e.width=t*o,e.height=r*o,e.style.width=t+`px`,e.style.height=r+`px`),n.viewport(0,0,e.width,e.height)}function p(){n.useProgram(a),n.uniform2f(c.uniforms.resolution,e.width,e.height),n.uniformMatrix2fv(c.uniforms.rotationMatrices,!1,Ne()),n.enable(n.BLEND),n.blendFunc(n.ONE,n.ONE_MINUS_SRC_ALPHA),n.clearColor(0,0,0,0)}function m(e){l&&=(n.clear(n.COLOR_BUFFER_BIT),s.forEach(t=>{let r=(e-t.startTime)/1e3;n.uniform1f(c.uniforms.time,r),n.uniform1f(c.uniforms.canvasWidth,t.config.width*o),n.uniform1f(c.uniforms.canvasHeight,t.config.height*o),n.uniform1f(c.uniforms.accelerationFactor,t.config.accelerationFactor),n.uniform1f(c.uniforms.fadeInTime,t.config.fadeInTime),n.uniform1f(c.uniforms.fadeOutTime,t.config.fadeOutTime),n.uniform1f(c.uniforms.edgeFadeZone,t.config.edgeFadeZone*o),n.uniform2f(c.uniforms.spawnCenter,t.centerX*o,t.centerY*o),n.bindBuffer(n.ARRAY_BUFFER,t.buffers.startPosition),n.enableVertexAttribArray(c.attributes.startPosition),n.vertexAttribPointer(c.attributes.startPosition,2,n.FLOAT,!1,0,0),n.bindBuffer(n.ARRAY_BUFFER,t.buffers.velocity),n.enableVertexAttribArray(c.attributes.velocity),n.vertexAttribPointer(c.attributes.velocity,2,n.FLOAT,!1,0,0),n.bindBuffer(n.ARRAY_BUFFER,t.buffers.startTime),n.enableVertexAttribArray(c.attributes.startTime),n.vertexAttribPointer(c.attributes.startTime,1,n.FLOAT,!1,0,0),n.bindBuffer(n.ARRAY_BUFFER,t.buffers.lifetime),n.enableVertexAttribArray(c.attributes.lifetime),n.vertexAttribPointer(c.attributes.lifetime,1,n.FLOAT,!1,0,0),n.bindBuffer(n.ARRAY_BUFFER,t.buffers.size),n.enableVertexAttribArray(c.attributes.size),n.vertexAttribPointer(c.attributes.size,1,n.FLOAT,!1,0,0),n.bindBuffer(n.ARRAY_BUFFER,t.buffers.baseOpacity),n.enableVertexAttribArray(c.attributes.baseOpacity),n.vertexAttribPointer(c.attributes.baseOpacity,1,n.FLOAT,!1,0,0),n.bindBuffer(n.ARRAY_BUFFER,t.buffers.color),n.enableVertexAttribArray(c.attributes.color),n.vertexAttribPointer(c.attributes.color,3,n.FLOAT,!1,0,0),n.drawArrays(n.POINTS,0,t.config.particleCount)}),requestAnimationFrame(m))}function h(e){let r=ce(),i={...B,...e},a={id:r,config:i,buffers:{startPosition:n.createBuffer(),velocity:n.createBuffer(),startTime:n.createBuffer(),lifetime:n.createBuffer(),size:n.createBuffer(),baseOpacity:n.createBuffer(),color:n.createBuffer()},startTime:performance.now(),seed:Math.floor(Math.random()*1e6),centerX:i.width/2+i.centerShift[0],centerY:i.height/2+i.centerShift[1],avgDistance:(i.width/2+i.height/2)/2};return s.set(r,a),d(a),f(),i.selfDestroyTime&&(a.selfDestroyTimeout=window.setTimeout(()=>{g(r)},i.selfDestroyTime*1e3)),s.size===1&&(p(),u=t.subscribe(()=>{let e=!t();e&&!l?l=requestAnimationFrame(m):!e&&l&&(cancelAnimationFrame(l),l=void 0)}),l=requestAnimationFrame(m)),()=>g(r)}function g(e){let t=s.get(e);t&&(t.selfDestroyTimeout&&clearTimeout(t.selfDestroyTimeout),Object.values(t.buffers).forEach(e=>{e&&n.deleteBuffer(e)}),s.delete(e),s.size===0&&_())}function _(){l!==void 0&&(cancelAnimationFrame(l),l=void 0),u?.(),s.clear(),n.deleteProgram(a),n.deleteShader(r),n.deleteShader(i),V.delete(e)}return{addSystem:h}}var Oe=`
    attribute vec2 a_startPosition;
    attribute vec2 a_velocity;
    attribute float a_startTime;
    attribute float a_lifetime;
    attribute float a_size;
    attribute float a_baseOpacity;
    attribute vec3 a_color;

    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_canvasWidth;
    uniform float u_canvasHeight;
    uniform float u_accelerationFactor;
    uniform float u_fadeInTime;
    uniform float u_fadeOutTime;
    uniform float u_edgeFadeZone;
    uniform mat2 u_rotationMatrices[18];
    uniform vec2 u_spawnCenter;

    varying float v_opacity;
    varying vec3 v_color;

    void main() {
        float totalAge = u_time - a_startTime;
        float age = mod(totalAge, a_lifetime);

        // For the initial animation, fade in all particles
        float globalFadeIn = min(u_time / u_fadeInTime, 1.0);

        float lifeRatio = age / a_lifetime;

        // Calculate rotation based on completed lifecycles
        float lifecycleCount = floor(totalAge / a_lifetime);
        int rotationIndex = int(mod(lifecycleCount, 18.0));

        // Get rotation matrix
        mat2 rotationMatrix = u_rotationMatrices[rotationIndex];

        // Rotate start position around spawn center
        vec2 startOffset = a_startPosition - u_spawnCenter;
        vec2 rotatedStartOffset = rotationMatrix * startOffset;
        vec2 rotatedStartPosition = u_spawnCenter + rotatedStartOffset;

        // Apply rotation matrix to velocity
        vec2 rotatedVelocity = rotationMatrix * a_velocity;

        // Apply shoot-out effect: fast initial speed that slows down
        float speedMultiplier = 1.0 + u_accelerationFactor * exp(-3.0 * lifeRatio);

        vec2 position = rotatedStartPosition + rotatedVelocity * age * speedMultiplier;

        float opacity = 1.0;
        if (lifeRatio < u_fadeInTime / a_lifetime) {
            opacity = (lifeRatio * a_lifetime) / u_fadeInTime;
        } else if (lifeRatio > 1.0 - u_fadeOutTime / a_lifetime) {
            opacity = (1.0 - lifeRatio) * a_lifetime / u_fadeOutTime;
        }
        opacity *= a_baseOpacity * globalFadeIn;

        float distToLeft = position.x;
        float distToRight = u_canvasWidth - position.x;
        float distToTop = position.y;
        float distToBottom = u_canvasHeight - position.y;
        float distToEdge = min(min(distToLeft, distToRight), min(distToTop, distToBottom));

        if (distToEdge < u_edgeFadeZone) {
            opacity *= distToEdge / u_edgeFadeZone;
        }

        vec2 clipSpace = ((position / u_resolution) * 2.0 - 1.0) * vec2(1, -1);
        gl_Position = vec4(clipSpace, 0, 1);
        gl_PointSize = a_size;
        v_opacity = opacity;
        v_color = a_color;
    }
`,ke=`
    precision mediump float;

    varying float v_opacity;
    varying vec3 v_color;

    void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);

        // Create a four-pointed star
        float absX = abs(coord.x);
        float absY = abs(coord.y);

        // Star parameters
        float innerSize = 0.12;    // Size of center square
        float armLength = 0.45;    // Length of star arms
        float armWidth = 0.08;     // Half-width of star arms at base

        float dist = 1.0; // Default to outside

        // Center square
        if (absX <= innerSize && absY <= innerSize) {
            dist = max(absX, absY) - innerSize;
        }
        // Horizontal arms (left and right points)
        else if (absY <= armWidth && absX <= armLength) {
            // Taper the arms - they get narrower toward the tips
            float normalizedX = (absX - innerSize) / (armLength - innerSize);
            float taperFactor = 1.0 - normalizedX * 0.8; // Taper to 20% of original width
            float currentArmWidth = armWidth * taperFactor;
            dist = absY - currentArmWidth;
        }
        // Vertical arms (top and bottom points)
        else if (absX <= armWidth && absY <= armLength) {
            // Taper the arms - they get narrower toward the tips
            float normalizedY = (absY - innerSize) / (armLength - innerSize);
            float taperFactor = 1.0 - normalizedY * 0.8; // Taper to 20% of original width
            float currentArmWidth = armWidth * taperFactor;
            dist = absX - currentArmWidth;
        }

        // Use smoothstep for anti-aliasing to reduce subpixel artifacts
        float alpha = 1.0 - smoothstep(-0.01, 0.01, dist);

        if (alpha <= 0.0) {
            discard;
        }

        gl_FragColor = vec4(v_color * v_opacity * alpha, v_opacity * alpha);
    }
`;function Ae(e,t,n){let r=e.createShader(t);if(r){if(e.shaderSource(r,n),e.compileShader(r),!e.getShaderParameter(r,e.COMPILE_STATUS)){e.deleteShader(r);return}return r}}function je(e,t,n){let r=e.createProgram();if(r){if(e.attachShader(r,t),e.attachShader(r,n),e.linkProgram(r),!e.getProgramParameter(r,e.LINK_STATUS)){e.deleteProgram(r);return}return r}}var Me=class{seed;constructor(e){this.seed=e}next(){return this.seed=(this.seed*9301+49297)%233280,this.seed/233280}nextBetween(e,t){return e+(t-e)*this.next()}},H;function Ne(){if(!H){H=new Float32Array(72);for(let e=0;e<18;e++){let t=220*Math.PI/180*e,n=Math.cos(t),r=Math.sin(t);H[e*4]=n,H[e*4+1]=r,H[e*4+2]=-r,H[e*4+3]=n}}return H}function Pe(e,t){if(e instanceof R)return e;let[n,r]=e,[i,a,o]=n.coords,[s,c,l]=r.coords;return new R(`srgb`,[t.nextBetween(i||0,s||0),t.nextBetween(a||0,c||0),t.nextBetween(o||0,l||0)])}var Fe={sparkles:`JxY8hVTW`},Ie={centerShift:[0,-36]},Le=8,Re=O(({color:e=`purple`,centerShift:t=Ie.centerShift,isDisabled:n,className:r,onRequestAnimation:i})=>{let a=I(),o=I(0);return te(()=>{if(!n)return Ee(a.current,{color:xe[`${e}Gradient`],centerShift:t})},[t,e,n]),A(()=>{i&&i(()=>{if(n)return;let r=Date.now();r-o.current<Le||(o.current=r,Ee(a.current,{color:xe[`${e}Gradient`],centerShift:t,...Se}))})},[t,e,n,i]),j(`canvas`,{ref:a,className:u(Fe.sparkles,r)})}),ze={root:`CHDf16MJ`,diamond:`UM7C8oRj`},Be=``+new URL(`diamond-57JalFxA.png`,import.meta.url).href,Ve=5,He=1,Ue=300,We=1500,U,W=!0;function Ge({className:e,onMouseMove:t}){let[n,r]=D(He),a=v(()=>{U&&=(clearTimeout(U),void 0),U=window.setTimeout(()=>{let e=Date.now();W=!0,x(()=>{if(!W)return!1;let t=Math.min((Date.now()-e)/We,1),n=(Ve-He)*(1-qe(t));return r(n),W=t<1&&n>1,W},i)},Ue),W=!1,r(Ve),t()});return j(`div`,{className:u(ze.root,e),children:j(`div`,{className:ze.diamond,onMouseMove:a,children:j(de,{speed:n,size:130,tgsUrl:w.Diamond,previewUrl:Be,nonInteractive:!0,noLoop:!1})})})}var Ke=O(Ge);function qe(e){return 1-(1-e)**2}var G={root:`QcfrGLdX`,star:`nDPg-zs5`,star_purple:`-f2S1Tk6`,starPurple:`-f2S1Tk6`},Je=50;function Ye({className:e,color:t,centerShift:n,onMouseMove:r}){let a=I(),o=v(e=>{let t=e.currentTarget.getBoundingClientRect(),o=t.left+t.width/2+n[0],s=t.top+t.height/2+n[1],c=e.clientX-o,l=e.clientY-s,u=Math.max(-1,Math.min(1,c/Je)),d=Math.max(-1,Math.min(1,l/Je)),f=u*40,p=-d*40;i(()=>{a.current.style.transform=`scale(1.1) rotateX(${p}deg) rotateY(${f}deg)`}),r()}),s=v(()=>{i(()=>{a.current.style.transform=``})});return j(`div`,{className:u(G.root,e),onMouseMove:o,onMouseLeave:s,children:j(`div`,{ref:a,className:u(G.star,G[`star_${t}`]),role:`img`,"aria-label":`Telegram Stars`})})}var Xe=O(Ye),K={root:`cK6KQXnQ`,"ai-egg":`ZP86O9Hy`,aiEgg:`ZP86O9Hy`,title:`xRm-Im3m`,description:`IQdQ9MU9`,particles:`_8ooQ3s8b`,stickerWrapper:`hHs2sTV-`,cocoon:`Rlhm9gZk`},Ze=``+new URL(`cocoon-DzgJltGQ.webp`,import.meta.url).href,q=8*oe,Qe={centerShift:[0,-36]};function $e({model:e,sticker:t,color:n,title:r,description:i,isDisabled:a,className:o,modelClassName:s}){let c=I(),l=I(),d=v(()=>{l.current?.()}),f=v(e=>{l.current=e});return E(`div`,{className:u(K.root,K[e],o),children:[j(Re,{color:n,centerShift:Qe.centerShift,isDisabled:a,className:K.particles,onRequestAnimation:f}),e===`swaying-star`?j(Xe,{className:s,color:n,centerShift:Qe.centerShift,onMouseMove:d}):e===`ai-egg`?j(`img`,{src:Ze,alt:``,role:`presentation`,"aria-hidden":`true`,className:u(K.cocoon,s),draggable:!1,onMouseMove:d}):e===`speeding-diamond`?j(Ke,{className:s,onMouseMove:d}):e===`sticker`&&t&&j(`div`,{ref:c,className:u(K.stickerWrapper,s),style:`width: ${q}px; height: ${q}px`,onMouseMove:d,children:j(le,{containerRef:c,sticker:t,size:q,shouldPreloadPreview:!0,shouldLoop:!0})}),j(`h2`,{className:K.title,children:r}),j(`div`,{className:K.description,children:i})]})}var et=O($e),J={root:`_7NV36hp3`,wrapper:`_32sWnI-2`,down:`DkDmNeYG`,frame:`M0hUT4cv`,video:`eWi57MWV`,placeholder:`A38HRiXg`},tt=``+new URL(`DeviceFrame-Dqm_t18H.svg`,import.meta.url).href,nt=O(({videoId:e,videoThumbnail:t,isActive:n,isReverseAnimation:r,isDown:i,index:a,className:o,wrapperClassName:s})=>{let c=T(e?`document${e}`:void 0),l=he(t?.dataUri),d=ae(c);return j(`div`,{className:u(J.root,o),children:E(`div`,{className:u(J.wrapper,r&&J.reverse,i&&J.down,s),id:a===void 0?void 0:`premium_feature_preview_video_${a}`,children:[j(`img`,{src:tt,alt:``,className:J.frame,draggable:!1}),!e&&j(`div`,{className:J.placeholder}),t&&j(`canvas`,{ref:l,className:J.video}),e&&j(g,{canPlay:!!n,className:u(J.video,d),src:c,disablePictureInPicture:!0,playsInline:!0,muted:!0,loop:!0})]})})}),Y={options:`Upert7zo`,option:`_2X6-9ciP`,active:`zpGahRpW`,wideOption:`dI8-J8yI`,optionTop:`wgA5YkCl`,stackedStars:`TZ71sXrE`,stackedStar:`_6CGkOJue`,optionBottom:`GRPtw1Lm`,moreOptions:`cY6CHTaj`,iconDown:`qdRs-uv4`},rt=6,it=O(({isActive:e,className:t,options:n,selectedStarOption:r,selectedStarCount:i,starsNeeded:a,onClick:o})=>{let d=F(),m=ie(),[h,g,_]=M();A(()=>{e||_()},[e]);let[v,b]=ee(()=>{if(!n)return[void 0,!1];let e=n.reduce((e,t)=>e.stars>t.stars?e:t),t=a&&e.stars<a,r=[],i=0,o=!1;return n.forEach((e,s)=>{if(e.isExtended||i++,!(a&&!t&&e.stars<a)){if(!h&&e.isExtended){o=!0;return}r.push({option:e,starsCount:Math.min(i,rt),isWide:s===n.length-1})}}),[r,o]},[h,n,a]);return E(`div`,{className:u(Y.options,t),children:[v?.map(({option:e,starsCount:t,isWide:n})=>{let a=v?.length%2==0,f=e===r,h;return e&&`winners`in e&&(h=(e.winners.find(e=>e.users===i)||e.winners.reduce((e,t)=>t.users>e.users?t:e,e.winners[0]))?.perUserStars),E(`div`,{className:u(Y.option,!a&&n&&Y.wideOption,f&&Y.active),onClick:()=>o?.(e),children:[E(`div`,{className:Y.optionTop,children:[`+`,p(e.stars),j(`div`,{className:Y.stackedStars,dir:m.isRtl?`ltr`:`rtl`,children:Array.from({length:t}).map(()=>j(s,{className:Y.stackedStar,type:`gold`,size:`big`}))})]}),j(`div`,{className:Y.optionBottom,children:c(m,e.amount,e.currency)}),(f||r&&`winners`in r)&&!!h&&j(`div`,{className:Y.optionBottom,children:j(`div`,{className:Y.perUserStars,children:l(d(`BoostGift.Stars.PerUser`,p(h)))})})]},e.stars)}),!h&&b&&E(y,{className:Y.moreOptions,isText:!0,noForcedUpperCase:!0,onClick:g,children:[d(`Stars.Purchase.ShowMore`),j(f,{className:Y.iconDown,name:`down`})]})]})}),X={content:`j63Xdo6p`,fixedHeight:`E-xx83T0`,withSearch:`sT1YPCzK`,header:`RwB3BKcO`,buttonWrapper:`Z-xvJZEk`},at=`.${fe.pickerList}`,ot=O(({confirmButtonText:e,isConfirmDisabled:t,shouldAdaptToSearch:n,withFixedHeight:r,onConfirm:i,withPremiumGradient:a,itemsContainerSelector:o=at,...s})=>{let c=F(),l=!!(e||i),d=I();return ge({containerRef:d,selector:`.modal-content ${o}`,isBottomNotch:l,shouldHideTopNotch:!0},[s.isOpen]),E(L,{...s,dialogRef:d,isSlim:!0,className:u(n&&X.withSearch,r&&X.fixedHeight,s.className),contentClassName:u(X.content,s.contentClassName),headerClassName:u(X.header,s.headerClassName),isCondensedHeader:!0,children:[s.children,l&&j(`div`,{className:X.buttonWrapper,children:j(y,{withPremiumGradient:a,onClick:i||s.onClose,color:`primary`,disabled:t,children:e||c(`Confirm`)})})]})}),Z={table:`RMEi5Sgb`,cell:`AEl8NMjg`,title:`IypKoG1m`,value:`ZO-KCUSl`,fullWidth:`_1WIqSuNB`,chatItem:`J6it2-iy`},st=O(({tableData:e,className:t,onChatClick:n})=>{let{openChat:r}=C(),i=v(e=>{n?n(e):r({id:e})});if(e?.length)return j(`div`,{className:u(Z.table,t),children:e.map(([e,t])=>E(se,{children:[!!e&&j(`div`,{className:u(Z.cell,Z.title),children:e}),j(`div`,{className:u(Z.cell,Z.value,!e&&Z.fullWidth),children:typeof t==`object`&&`chatId`in t?j(_e,{peerId:t.chatId,className:Z.chatItem,forceShowSelf:!0,withEmojiStatus:t.withEmojiStatus,clickArg:t.chatId,onClick:i}):t})]}))})}),Q={content:`rIjOLQyf`,noFooter:`ssGgYoZw`,avatar:`IdvEatvm`},ct=O(({isOpen:e,title:t,tableData:n,headerAvatarPeer:r,header:i,modalHeader:a,footer:s,buttonText:c,className:l,contentClassName:d,tableClassName:f,hasBackdrop:p,closeButtonColor:m,moreMenuItems:h,headerRightToolBar:g,onClose:_,onButtonClick:b,withBalanceBar:x,isLowStackPriority:S,currencyInBalanceBar:w})=>{let{openChat:ee}=C(),T=v(e=>{ee({id:e}),_()});return E(L,{isOpen:e,hasCloseButton:!!t,hasAbsoluteCloseButton:!t,absoluteCloseButtonColor:m||(p?`translucent-white`:void 0),isSlim:!0,header:a,title:t,className:l,contentClassName:u(Q.content,d),moreMenuItems:h,headerRightToolBar:g,onClose:_,withBalanceBar:x,currencyInBalanceBar:w,isLowStackPriority:S,children:[r&&j(o,{peer:r,size:`jumbo`,className:Q.avatar}),i,j(st,{tableData:n,className:f,onChatClick:T}),s,c&&j(y,{className:s?void 0:Q.noFooter,onClick:b||_,children:c})]})}),$={root:`FEEwg5rl`,secondary:`_51eeI1vd`,topIcon:`_0fVPMdEi`,premiumGradient:`oEaPoig5`,content:`_7xJ2IMc7`,listItems:`_4Smlf3-h`,listItemTitle:`lPVHA-w3`,separator:`V6iMhrLh`},lt=O(({className:e,isOpen:t,listItemData:n,headerIconName:r,headerIconPremiumGradient:i,header:a,footer:o,buttonText:s,hasBackdrop:c,absoluteCloseButtonColor:l,withSeparator:d,contentClassName:p,onClose:m,onButtonClick:h})=>E(L,{isOpen:t,className:u($.root,e),contentClassName:u($.content,p),hasAbsoluteCloseButton:!0,absoluteCloseButtonColor:l||(c?`translucent-white`:void 0),onClose:m,children:[r&&j(`div`,{className:u($.topIcon,i&&$.premiumGradient),children:j(f,{name:r})}),a,j(`div`,{className:$.listItems,children:n?.map(([e,t,n])=>E(ue,{isStatic:!0,multiline:!0,icon:e,className:$.listItem,children:[j(`span`,{className:u(`title`,$.listItemTitle),children:t}),j(`span`,{className:`subtitle`,children:n})]}))}),d&&j(pe,{className:$.separator}),o,!!s&&j(y,{onClick:h||m,children:s})]}));function ut(t,n,r){let[i,a]=D(),{isFrozen:o,updateWhenUnfrozen:s}=dt(),c=me(n,!0);return e(()=>{if(o){s();return}c(()=>{a(t())})},[...r,o]),i}function dt(){let e=I(!1),t=P(()=>{e.current=!0},[]),i=re();return n(ft,P(()=>{e.current&&(e.current=!1,i())},[i])),{isFrozen:r(),updateWhenUnfrozen:t}}function ft(){}var pt=300;async function mt(e){let t=await N(`searchChats`,{query:e});if(t)return[...t.accountResultIds,...t.globalResultIds]}function ht(e){return async t=>{let n=t.trim();if(b(e)){let t=d(h(),e.id)?.members?.map(e=>e.userId)||[];return n?S({ids:t,query:n,type:`user`}):t}let r=(await N(`fetchMembers`,{chat:e,memberFilter:n?`search`:`recent`,query:n}))?.members?.map(e=>e.userId)||[];if(!k(e))return r;if(!n)return[...r,e.id];let i=S({ids:[e.id],query:n,type:`chat`});return[...r,...i]}}function gt({query:e,queryFn:t=mt,defaultValue:n,debounceTimeout:r=pt,isDisabled:i}){let a=ut(()=>e,r,[e]),[o,s]=D(``),c=e&&a,l=v(t);return{...ne(async()=>{if(!c||i)return s(``),Promise.resolve(n);let e=await l(c);return s(c),e},[c,n,l,i],n),currentResultsQuery:o}}var _t={root:`JaXKxj2K`,arrow:`_-7ow-ETi`},vt=4*oe,yt=O(({fromPeer:e,toPeer:t,avatarSize:n=vt})=>E(`div`,{className:_t.root,children:[j(o,{peer:e,size:n}),j(f,{name:`next`,className:_t.arrow}),j(o,{peer:t,size:n})]}));export{ct as a,it as c,Re as d,ye as f,lt as i,nt as l,ht as n,st as o,ve as p,gt as r,ot as s,yt as t,et as u};
//# sourceMappingURL=TransferBetweenPeers-s9euHm9j.js.map