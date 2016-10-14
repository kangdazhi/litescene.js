/**
* RenderInstance contains info of one object to be rendered on the scene.
*
* @class RenderInstance
* @namespace LS
* @constructor
*/

function RenderInstance( node, component )
{
	this._key = ""; //not used yet
	this.uid = LS.generateUId("RINS"); //unique identifier for this RI
	this.layers = 3;
	this.index = -1; //used to know the rendering order

	//info about the mesh
	this.vertex_buffers = {};
	this.index_buffer = null;
	this.wireframe_index_buffer = null;
	this.range = new Int32Array([0,-1]); //start, offset
	this.primitive = gl.TRIANGLES;

	this.mesh = null; //shouldnt be used (buffers are added manually), but just in case
	this.collision_mesh = null; //in case of raycast

	//used in case the object has a secondary mesh
	this.lod_mesh = null;
	this.lod_vertex_buffers = {};
	this.lod_index_buffer = null;

	//where does it come from
	this.node = node;
	this.component = component;
	this.priority = 10; //only used if the RenderQueue is in PRIORITY MODE, instances are rendered from higher to lower priority

	//transformation
	this.matrix = mat4.create();
	this.normal_matrix = mat4.create();
	this.center = vec3.create();

	//for visibility computation
	this.oobb = BBox.create(); //object space bounding box
	this.aabb = BBox.create(); //axis aligned bounding box

	//info about the material
	this.material = null;
	this.use_bounding = true;

	//for extra data for the shader
	this.query = new LS.ShaderQuery();
	this.uniforms = {};
	this.samplers = [];
	this.shader_blocks = [];
	//this.deformers = []; //TODO

	//TO DO: instancing
	//this.uniforms_instancing = {};

	//for internal use
	this._camera_visibility = 0; //tells in which camera was visible this instance during the last rendering (using bit operations)
	this._is_visible = false; //used during the rendering to mark if it was seen
	this._dist = 0; //computed during rendering, tells the distance to the current camera
	this._final_query = new LS.ShaderQuery();
}

/*
//not used
RenderInstance.prototype.generateKey = function(step, options)
{
	this._key = step + "|" + this.node.uid + "|" + this.material.uid + "|";
	return this._key;
}
*/

//set the material and apply material flags to render instance
RenderInstance.prototype.setMatrix = function(matrix, normal_matrix)
{
	this.matrix.set( matrix );

	if( normal_matrix )
		this.normal_matrix.set( normal_matrix )
	else
		this.computeNormalMatrix();
}

/**
* Updates the normal matrix using the matrix
*
* @method computeNormalMatrix
*/
RenderInstance.prototype.computeNormalMatrix = function()
{
	var m = mat4.invert(this.normal_matrix, this.matrix);
	if(m)
		mat4.transpose(this.normal_matrix, m);
}

//set the material and apply material flags to render instance
RenderInstance.prototype.setMaterial = function(material)
{
	this.material = material;
	if(material && material.applyToRenderInstance)
		material.applyToRenderInstance(this);
}

//sets the buffers to render, the primitive, and the bounding
RenderInstance.prototype.setMesh = function(mesh, primitive)
{
	if( primitive == -1 || primitive === undefined )
		primitive = gl.TRIANGLES;
	this.primitive = primitive;

	if(mesh != this.mesh)
	{
		this.mesh = mesh;
		this.vertex_buffers = {};
	}
	//this.vertex_buffers = mesh.vertexBuffers;
	for(var i in mesh.vertexBuffers)
		this.vertex_buffers[i] = mesh.vertexBuffers[i];

	switch(primitive)
	{
		case gl.TRIANGLES: 
			this.index_buffer = mesh.indexBuffers["triangles"]; //works for indexed and non-indexed
			break;
		case gl.LINES: 
			/*
			if(!mesh.indexBuffers["lines"])
				mesh.computeWireframe();
			*/
			this.index_buffer = mesh.indexBuffers["lines"];
			break;
		case 10:  //wireframe
			this.primitive = gl.LINES;
			if(!mesh.indexBuffers["wireframe"])
				mesh.computeWireframe();
			this.index_buffer = mesh.indexBuffers["wireframe"];
			break;

		case gl.POINTS: 
		default:
			this.index_buffer = null;
			break;
	}

	if(mesh.bounding)
	{
		this.oobb.set( mesh.bounding ); //copy
		this.use_bounding = true;
	}
	else
		this.use_bounding = false;
}

//assigns a secondary mesh in case the object is too small on the screen
RenderInstance.prototype.setLODMesh = function(lod_mesh)
{
	if(!lod_mesh)
	{
		this.lod_mesh = null;
		this.lod_vertex_buffers = null;
		this.lod_index_buffer = null;
		return;
	}

	if(lod_mesh != this.lod_mesh)
	{
		this.lod_mesh = lod_mesh;
		this.lod_vertex_buffers = {};
	}
	//this.vertex_buffers = mesh.vertexBuffers;
	for(var i in lod_mesh.vertexBuffers)
		this.lod_vertex_buffers[i] = lod_mesh.vertexBuffers[i];

	switch(this.primitive)
	{
		case gl.TRIANGLES: 
			this.lod_index_buffer = lod_mesh.indexBuffers["triangles"]; //works for indexed and non-indexed
			break;
		case gl.LINES: 
			/*
			if(!mesh.indexBuffers["lines"])
				mesh.computeWireframe();
			*/
			this.lod_index_buffer = lod_mesh.indexBuffers["lines"];
			break;
		case 10:  //wireframe
			if(!lod_mesh.indexBuffers["wireframe"])
				lod_mesh.computeWireframe();
			this.lod_index_buffer = lod_mesh.indexBuffers["wireframe"];
			break;
		case gl.POINTS: 
		default:
			this.lod_index_buffer = null;
			break;
	}
}

RenderInstance.prototype.setRange = function(start, offset)
{
	this.range[0] = start;
	this.range[1] = offset;
}

/**
* Enable flag in the flag bit field
*
* @method enableFlag
* @param {number} flag id
*/
RenderInstance.prototype.enableFlag = function(flag)
{
	this.flags |= flag;
}

/**
* Disable flag in the flag bit field
*
* @method enableFlag
* @param {number} flag id
*/
RenderInstance.prototype.disableFlag = function(flag)
{
	this.flags &= ~flag;
}

/**
* Tells if a flag is enabled
*
* @method enableFlag
* @param {number} flag id
* @return {boolean} flag value
*/
RenderInstance.prototype.isFlag = function(flag)
{
	return (this.flags & flag);
}

/**
* Computes the instance bounding box in world space from the one in local space
*
* @method updateAABB
*/
RenderInstance.prototype.updateAABB = function()
{
	BBox.transformMat4(this.aabb, this.oobb, this.matrix );
}

/**
* Used to update the RI info without having to go through the collectData process, it is faster but some changes may take a while
*
* @method update
*/
RenderInstance.prototype.update = function()
{
	if(!this.node || !this.node.transform)
		return;
	this.setMatrix( this.node.transform._global_matrix );
}

/**
* Calls render taking into account primitive and range
*
* @method render
* @param {Shader} shader
*/
RenderInstance.prototype.render = function(shader)
{
	if(this.lod_mesh)
	{
		//very bad LOD function...
		var f = this.oobb[12] / Math.max(0.1, this._dist);
		if( f < 0.1 )
		{
			shader.drawBuffers( this.lod_vertex_buffers,
			  this.lod_index_buffer,
			  this.primitive);
			return;
		}
	}

	shader.drawBuffers( this.vertex_buffers,
	  this.index_buffer,
	  this.primitive, this.range[0], this.range[1] );
}

//checks the shader blocks attached to this instance and resolves the flags
RenderInstance.prototype.computeShaderBlockFlags = function()
{
	var r = 0;
	for(var i = 0; i < this.shader_blocks.length; ++i)
	{
		var shader_block = this.shader_blocks[i];
		if(!shader_block)
			continue;
		var block = this.shader_blocks[i].block;
		r |= block.flag_mask;
	}
	return r;
}

/*
RenderInstance.prototype.renderInstancing = function( shader )
{
	var instances_info = this.instances_info;

	var matrices = new Float32Array( instances_info.length * 16 );
	for(var j = 0; j < instances_info.length; ++j)
	{
		var matrix = instances_info[j].matrix;
		matrices.set( matrix, j*16 );
	}

	gl.bindBuffer(gl.ARRAY_BUFFER, matricesBuffer );
	gl.bufferData(gl.ARRAY_BUFFER, matrices, gl.STREAM_DRAW);

	// Bind the instance matrices data (mat4 behaves as 4 attributes)
	for(var k = 0; k < 4; ++k)
	{
		gl.enableVertexAttribArray( location+k );
		gl.vertexAttribPointer( location+k, 4, gl.FLOAT , false, 16*4, k*4*4 );
		ext.vertexAttribDivisorANGLE( location+k, 1 ); // This makes it instanced!
	}

	//gl.drawElements( gl.TRIANGLES, length, indexBuffer.buffer.gl_type, 0 ); //gl.UNSIGNED_SHORT
	ext.drawElementsInstancedANGLE( gl.TRIANGLES, length, indexBuffer.buffer.gl_type, 0, batch.length );
	GFX.stats.calls += 1;
	for(var k = 0; k < 4; ++k)
	{
		ext.vertexAttribDivisorANGLE( location+k, 0 );
		gl.disableVertexAttribArray( location+k );
	}
}
*/

RenderInstance.prototype.overlapsSphere = function( center, radius )
{
	//we dont know if the bbox of the instance is valid
	if( !this.use_bounding )
		return true;
	return geo.testSphereBBox( center, radius, this.aabb );
}

/**
* Checks if this object was visible by a camera during the last frame
*
* @method wasVisibleByCamera
* @param {LS.Camera} camera [optional] if a camera is supplied it checks if it was visible by that camera, otherwise tells you if it was visible by any camera
* @return {Boolean} true if it was visible by the camera (or any camera if no camera supplied), false otherwise
*/
RenderInstance.prototype.wasVisibleByCamera = function( camera )
{
	if(!camera)
		return this._camera_visibility != 0;
	return (this._camera_visibility | (1<<(camera._rendering_index))) ? true : false;
}

LS.RenderInstance = RenderInstance;