

var roleClaimer = {

    /** @param {Creep} creep **/
    run: function (creep) {
        var goalFlag = Game.flags.ClaimThis;
        if(goalFlag.color == COLOR_BLUE){
        }
        else if(creep.room !== goalFlag.room){
            creep.moveTo(goalFlag.pos);
        }
        else{
            var goal = creep.room.controller;
            if(goal.my){
                creep.room.createConstructionSite(goalFlag.pos,STRUCTURE_SPAWN);
                goalFlag.setColor(COLOR_BLUE);
            }
            if(goalFlag.color === COLOR_GREEN && creep.claimController(goal) === ERR_NOT_IN_RANGE){
                creep.moveTo(goal);
            }
        }
    }
    }

module.exports = roleClaimer;