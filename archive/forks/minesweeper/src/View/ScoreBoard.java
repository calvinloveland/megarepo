package View;

import Control.Game;
import javafx.application.Platform;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.layout.HBox;
import javafx.util.converter.NumberStringConverter;

import java.util.Timer;
import java.util.TimerTask;

/**
 * ScoreBoard -
 *
 * @author: Calvin Loveland
 * @version: 1.0
 */
public class ScoreBoard extends HBox {
    Label timerLabel = new Label("Timer: 0.0");
    public double time = 0;
    Label bombCount = new Label("0");
    Button restart = new Button("Restart");
    Timer timer = new Timer();
    Game game;
    ScoreBoard(Game g){
        game = g;
        game.setScoreBoard(this);
        updateBombs();
        restart.setOnAction(event -> restart());
        getChildren().addAll(bombCount,restart,timerLabel);
        setAlignment(Pos.CENTER);
        setPrefWidth(600);
        setPrefHeight(200);
        bombCount.setPrefWidth(200);
        bombCount.setAlignment(Pos.CENTER_RIGHT);
        timerLabel.setPrefWidth(200);
        timerLabel.setAlignment(Pos.CENTER_LEFT);
        setSpacing(25);
    }
    public void startTimer(){
        timer = new Timer();
            timer.schedule(new TimerTask() {
                               @Override
                               public void run() {
                                   Platform.runLater(() -> incrementTimer());
                               }
                           }
                    , 0, 10);
    }
    public void stopTimer(){
        timer.cancel();
    }
    void incrementTimer(){
        time += .01;
        time = Math.round(time * 100.0)/100.0;
        timerLabel.setText("Timer: " + time);
    }
    void resetTimer(){
        time = 0.0;
        timerLabel.setText("Timer: 0.0");
    }
    public void updateBombs(){
        bombCount.setText((game.totalBombs-game.flags) + " Bombs Remaining");
    }
    void restart(){
        game.restart();
        updateBombs();
        Platform.runLater(() -> resetTimer());
    }
}
