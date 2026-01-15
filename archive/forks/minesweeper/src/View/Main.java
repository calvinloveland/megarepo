package View;

import Control.Game;
import javafx.application.Application;
import javafx.event.EventHandler;
import javafx.scene.Scene;
import javafx.scene.layout.GridPane;
import javafx.scene.layout.Pane;
import javafx.stage.Stage;
import javafx.stage.WindowEvent;

public class Main extends Application {

    @Override
    public void start(Stage primaryStage) throws Exception{
        //My beautiful setup code is reused once again!
        Pane root = new Pane();
        Pane scorePane = new Pane();
        Pane boardPane = new Pane();

        root.getChildren().add(scorePane);
        root.getChildren().add(boardPane);
        Scene mainScene = new Scene(root,600,800);
        primaryStage.setScene(mainScene);

        boardPane.setLayoutY(200); //Jank it into place
        //boardPane.setLayoutX(150);
        boardPane.prefWidthProperty().bind(mainScene.widthProperty());
        boardPane.prefHeightProperty().bind(mainScene.heightProperty());

        Game game = new Game();
        Board board = new Board(game);
        ScoreBoard scoreBoard = new ScoreBoard(game);
        scorePane.getChildren().add(scoreBoard);
        boardPane.getChildren().add(board);
        boardPane.getStylesheets().add("View/styles.css");
        primaryStage.show();
        primaryStage.setOnCloseRequest(new EventHandler<WindowEvent>() {
            @Override
            public void handle(WindowEvent event) {
                game.stopTimer();
            }
        });
    }


    public static void main(String[] args) {
        launch(args);
    }
}
