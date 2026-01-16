var findEnergy = require("helper.findEnergy");

var signText = "Please don't hurt me <3"

var roleUpgrader = {
    
    /** @param {Creep} creep **/
    run : function (creep) {
        if (creep.carry.energy === 0) {
            creep.memory.working = false;
        }
         if(typeof(creep.room.controller) !== "undefined" 
         && typeof(creep.room.controller.sign) !== "undefined" 
         && creep.room.controller.sign.text !== signText){
             if(creep.signController(creep.room.controller,signText) === ERR_NOT_IN_RANGE){
                 creep.moveTo(creep.room.controller);
             }
         }
        else if (creep.carry.energy < creep.carryCapacity && creep.memory.working === false) {
            findEnergy.doIt(creep);
        }
        else {
            creep.memory.working = true;
                if (typeof(creep.room.controller) === "undefined" || !creep.room.controller.my) {
                    creep.moveTo(Game.spawns["Spawn1"]);
                }
                else if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(creep.room.controller);
                    creep.memory.upgradingController = true;

                }
        }
    }
}

module.exports = roleUpgrader;