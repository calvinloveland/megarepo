package Control;

import View.Board;
import View.ScoreBoard;
import javafx.beans.property.DoubleProperty;
import javafx.beans.property.SimpleDoubleProperty;
import javafx.scene.control.Alert;

import java.util.Timer;
import java.util.TimerTask;

/**
 * Game -
 *
 * @author: Calvin Loveland
 * @version: 1.0
 */
public class Game {
    Board board;
    ScoreBoard scoreBoard;
    int markedBombs;
    public int totalBombs;
    public int flags;
    boolean started = false;

    public void click(){
        if(!started){
            started = true;
            scoreBoard.startTimer();
        }
    }
    public void markBomb(boolean bomb){

        flags++; //Had this below the check took me way too long to find out why stuff wasn't working
        if(bomb){
            markedBombs++;
            if((markedBombs == totalBombs) && (flags == totalBombs)){
                win();
                System.out.println("WIN");
            }
            //System.out.println("Bombs: " + markedBombs + " Flags: " + flags + " Total Bombs: " + totalBombs + (markedBombs == totalBombs) + (flags == markedBombs) + ((markedBombs == totalBombs) && (flags == totalBombs)));
        }
        scoreBoard.updateBombs();
        //System.out.println("Bombs: " + markedBombs + " Flags: " + flags + " Total Bombs: " + totalBombs + (markedBombs == totalBombs) + (flags == markedBombs));
    }
    public void unMarkBomb(boolean bomb){

        if(bomb)
            markedBombs--;
        flags--;
        scoreBoard.updateBombs();
    }
    public void setTotalBombs(int tb){
        totalBombs = tb;
    }
    public void setBoard(Board b){
        board = b;
    }
    public void setScoreBoard(ScoreBoard s){scoreBoard = s;}
    void win(){
        board.revealBombs();
        scoreBoard.stopTimer();
        Alert winAlert = new Alert(Alert.AlertType.INFORMATION);
        winAlert.setContentText("You won! It only took you: " + scoreBoard.time + " seconds!");
        winAlert.setTitle("Winner");
        winAlert.setGraphic(null);
        winAlert.setHeaderText(null);
        winAlert.show();
    }
    public void lose(){
        board.revealBombs();
        scoreBoard.stopTimer();
        Alert loseAlert = new Alert(Alert.AlertType.INFORMATION);
        loseAlert.setContentText("You lost in only: " + scoreBoard.time + " seconds!");
        loseAlert.setTitle("Loser");
        loseAlert.setGraphic(null);
        loseAlert.setHeaderText(null);
        loseAlert.show();
    }
    public void stopTimer(){
        scoreBoard.stopTimer();
    }
    public void restart(){
        board.restart();
        stopTimer();
        started = false;
        flags = 0;
        markedBombs = 0;
    }
}
